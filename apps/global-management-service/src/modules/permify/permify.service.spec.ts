import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { status } from '@grpc/grpc-js';
import * as permify from '@permify/permify-node';

jest.mock('@permify/permify-node', () => {
  const base = {
    CheckResult: { CHECK_RESULT_ALLOWED: 1, CHECK_RESULT_DENIED: 0 },
    BooleanValue: {
      encode: () => ({ finish: () => new Uint8Array() }),
      decode: () => ({ data: true }),
    },
  };
  return { grpc: { newClient: jest.fn(), base } };
});

import SecretsService from 'src/core/secrets/secrets.service';
import {
  permifyCallOptions,
  PermifyDeadlineExceededError,
  resolvePermifyDeadlineMs,
} from './permify-call-options';
import { PermifyService } from './permify.service';

type PermifyClientMock = {
  permission: { check: jest.Mock };
  data: {
    write: jest.Mock;
    readAttributes: jest.Mock;
    readRelationships: jest.Mock;
    writeRelationships: jest.Mock;
    deleteRelationships: jest.Mock;
  };
};

describe('PermifyService', () => {
  const ALLOWED = 1;

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const build = (
    client: Partial<PermifyClientMock>,
    overrides: Record<string, string> = {},
  ) => {
    const values: Record<string, string> = {
      PERMIFY_ENDPOINT: '127.0.0.1:3478',
      PERMIFY_SCHEMA_VERSION: 'v1',
      ...overrides,
    };
    const config = {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
    const secrets = {
      getSecret: jest.fn(() => undefined),
    } as unknown as SecretsService;
    const logger = { log: jest.fn(), error: jest.fn() } as unknown as Logger;

    (permify.grpc.newClient as unknown as jest.Mock).mockReturnValue(client);
    const service = new PermifyService(config, secrets, logger);
    return Object.assign(service, { __logger: logger }) as PermifyService & {
      __logger: Logger;
    };
  };

  describe('Permify call deadline', () => {
    /**
     * Every RPC this service makes must carry the deadline — not just the
     * check: a write or a delete against a saturated Permify hangs just as
     * long.
     */
    const rpcs: ReadonlyArray<
      [string, (svc: PermifyService) => Promise<unknown>, string[]]
    > = [
      [
        'permission.check',
        (svc) =>
          svc.checkPermission('r1', 'u1', 'user', 'organization', 'read'),
        ['permission', 'check'],
      ],
      [
        'data.write (setOrganizationActive)',
        (svc) => svc.setOrganizationActive('o1', true),
        ['data', 'write'],
      ],
      [
        'data.write (setOrganizationProductAttributes)',
        (svc) =>
          svc.setOrganizationProductAttributes('o1', {
            is_active: false,
            writes_blocked: false,
            vibedefend_active: false,
          }),
        ['data', 'write'],
      ],
      [
        'data.readAttributes (getOrganizationActive)',
        (svc) => svc.getOrganizationActive('o1'),
        ['data', 'readAttributes'],
      ],
      [
        'data.readRelationships',
        (svc) =>
          svc.readRelationships({
            entity: { type: 'organization', id: 'r1' },
            subject: { type: 'user', id: 'u1' },
          }),
        ['data', 'readRelationships'],
      ],
      [
        'data.writeRelationships (writePermission)',
        (svc) =>
          svc.writePermission('r1', 'u1', 'user', 'organization', 'member'),
        ['data', 'writeRelationships'],
      ],
      [
        'data.deleteRelationships (deletePermission)',
        (svc) =>
          svc.deletePermission('r1', 'u1', 'user', 'organization', 'member'),
        ['data', 'deleteRelationships'],
      ],
      [
        'data.deleteRelationships (deleteAllPermissions)',
        (svc) => svc.deleteAllPermissions('r1', 'organization'),
        ['data', 'deleteRelationships'],
      ],
      [
        'data.writeRelationships (writeMemberProductTuples)',
        (svc) =>
          svc.writeMemberProductTuples('o1', 'u1', ['appsec', 'vibedefend']),
        ['data', 'writeRelationships'],
      ],
      [
        'data.deleteRelationships (writeMemberProductTuples, no product)',
        (svc) => svc.writeMemberProductTuples('o1', 'u1', []),
        ['data', 'deleteRelationships'],
      ],
      [
        'data.writeRelationships (grantProductTuples)',
        (svc) => svc.grantProductTuples('o1', 'vibedefend', ['u1', 'u2']),
        ['data', 'writeRelationships'],
      ],
      [
        'data.write (setMemberProductsSwitch)',
        (svc) => svc.setMemberProductsSwitch('o1', true),
        ['data', 'write'],
      ],
      [
        'data.delete (deleteOrganizationAttributes)',
        (svc) =>
          svc.deleteOrganizationAttributes(
            '55555555-5555-4555-8555-555555555555',
          ),
        ['data', 'delete'],
      ],
    ];

    it.each(rpcs)(
      '%s carries the options as its second argument',
      async (_label, invoke, path) => {
        const rpc = jest
          .fn()
          .mockResolvedValue({ can: ALLOWED, snapToken: 's1', tuples: [] });
        const client: Partial<PermifyClientMock> = {
          permission: { check: jest.fn() },
          data: {
            write: jest.fn(),
            readAttributes: jest.fn(),
            readRelationships: jest.fn(),
            writeRelationships: jest.fn(),
            deleteRelationships: jest.fn(),
          },
        };
        (client as Record<string, Record<string, jest.Mock>>)[path[0]][
          path[1]
        ] = rpc;

        const service = build(client);
        await invoke(service);

        expect(rpc).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      },
    );

    it.each(rpcs)(
      '%s aborts after 2s when Permify hangs',
      async (_label, invoke, path) => {
        jest.useFakeTimers();
        const rpc = jest.fn(
          (_request, options) =>
            new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () =>
                reject(options.signal.reason),
              );
            }),
        );
        const client: Partial<PermifyClientMock> = {
          permission: { check: jest.fn() },
          data: {
            write: jest.fn(),
            readAttributes: jest.fn(),
            readRelationships: jest.fn(),
            writeRelationships: jest.fn(),
            deleteRelationships: jest.fn(),
          },
        };
        (client as Record<string, Record<string, jest.Mock>>)[path[0]][
          path[1]
        ] = rpc;

        const service = build(client);
        const pending = invoke(service);
        const expectation =
          expect(pending).rejects.toBeInstanceOf(RpcException);

        const { signal } = rpc.mock.calls[0][1];
        await jest.advanceTimersByTimeAsync(1999);
        expect(signal.aborted).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        expect(signal.aborted).toBe(true);
        expect(signal.reason.code).toBe(status.DEADLINE_EXCEEDED);

        await expectation;
      },
    );

    it('arms no timer once the call has come back', async () => {
      jest.useFakeTimers();
      const check = jest.fn().mockResolvedValue({ can: ALLOWED });
      const service = build({ permission: { check } });

      await service.checkPermission('r1', 'u1', 'user', 'organization', 'read');

      expect(jest.getTimerCount()).toBe(0);
    });

    it('honours PERMIFY_RPC_DEADLINE_MS', async () => {
      jest.useFakeTimers();
      const check = jest.fn(
        (_request, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(options.signal.reason),
            );
          }),
      );
      const service = build(
        { permission: { check } },
        { PERMIFY_RPC_DEADLINE_MS: '300' },
      );

      const pending = service.checkPermission(
        'r1',
        'u1',
        'user',
        'organization',
        'read',
      );
      const expectation = expect(pending).rejects.toBeInstanceOf(RpcException);

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
    ])(
      'maps %s to an RpcException with status UNAVAILABLE, never an HttpException',
      async (_label, error) => {
        const check = jest.fn().mockRejectedValue(error);
        const service = build({ permission: { check } });

        await expect(
          service.checkPermission('r1', 'u1', 'user', 'organization', 'read'),
        ).rejects.toBeInstanceOf(RpcException);

        await expect(
          service.checkPermission('r1', 'u1', 'user', 'organization', 'read'),
        ).rejects.toMatchObject({
          error: { code: status.UNAVAILABLE },
        });
      },
    );

    /**
     * The whole point of the call deadline is the Permify outage path; it is
     * the last
     * place that may go quiet. Mapping to UNAVAILABLE must not cost us the log
     * line (message + metadata) that already existed for every other failure.
     */
    it.each(rpcs)(
      '%s logs before mapping an unavailable Permify',
      async (_label, invoke, path) => {
        const rpc = jest
          .fn()
          .mockRejectedValue(new PermifyDeadlineExceededError(2000));
        const client: Partial<PermifyClientMock> = {
          permission: { check: jest.fn() },
          data: {
            write: jest.fn(),
            readAttributes: jest.fn(),
            readRelationships: jest.fn(),
            writeRelationships: jest.fn(),
            deleteRelationships: jest.fn(),
          },
        };
        (client as Record<string, Record<string, jest.Mock>>)[path[0]][
          path[1]
        ] = rpc;

        const service = build(client);
        await expect(invoke(service)).rejects.toBeInstanceOf(RpcException);

        expect(service.__logger.error).toHaveBeenCalledTimes(1);
        expect(service.__logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Error while'),
        );
      },
    );

    it('still surfaces any other error as today', async () => {
      const check = jest.fn().mockRejectedValue(
        Object.assign(new Error('boom'), {
          code: status.INTERNAL,
        }),
      );
      const service = build({ permission: { check } });

      await expect(
        service.checkPermission('r1', 'u1', 'user', 'organization', 'read'),
      ).rejects.not.toBeInstanceOf(RpcException);
    });
  });

  /**
   * The RPC shape, the return mapping and the failure wrapping; the deadline
   * comes from the shared helper, which is what bounds this call.
   */
  describe('readRelationships', () => {
    const buildWithReads = (readRelationships: jest.Mock) =>
      build({
        data: {
          write: jest.fn(),
          readAttributes: jest.fn(),
          readRelationships,
          writeRelationships: jest.fn(),
          deleteRelationships: jest.fn(),
        },
      });

    it('issues exactly one ReadRelationships RPC filtered on the entity and the subject', async () => {
      const rpc = jest.fn().mockResolvedValue({ tuples: [] });
      const service = buildWithReads(rpc);

      await service.readRelationships({
        entity: { type: 'team', id: 'team-1' },
        subject: { type: 'user', id: 'user-1' },
      });

      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc.mock.calls[0][0]).toEqual({
        tenantId: 't1',
        metadata: { snapToken: '' },
        filter: {
          entity: { type: 'team', ids: ['team-1'] },
          subject: { type: 'user', ids: ['user-1'] },
        },
        // Permify's server-side default is 50 when unset. Our filter can return
        // at most one tuple per declared relation (8 in this schema), so this is
        // purely a guard against that default changing under us.
        pageSize: 100,
      });
    });

    it('bounds the RPC with the Permify deadline (2 s by default)', async () => {
      const rpc = jest.fn().mockResolvedValue({ tuples: [] });
      const service = buildWithReads(rpc);

      await service.readRelationships({
        entity: { type: 'organization', id: 'org-1' },
        subject: { type: 'user', id: 'user-1' },
      });

      // nice-grpc ignores `deadline` outright, so the contract that matters —
      // and the one
      // the other RPCs are held to — is that the call receives a signal.
      const options = rpc.mock.calls[0][1];
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.signal.aborted).toBe(false);
    });

    it('returns the relation name of every tuple', async () => {
      const rpc = jest.fn().mockResolvedValue({
        tuples: [
          {
            entity: { type: 'team', id: 'team-1' },
            relation: 'team_manager',
            subject: { type: 'user', id: 'user-1' },
          },
          {
            entity: { type: 'team', id: 'team-1' },
            relation: 'developer',
            subject: { type: 'user', id: 'user-1' },
          },
        ],
      });
      const service = buildWithReads(rpc);

      await expect(
        service.readRelationships({
          entity: { type: 'team', id: 'team-1' },
          subject: { type: 'user', id: 'user-1' },
        }),
      ).resolves.toEqual(['team_manager', 'developer']);
    });

    it('returns an empty list when the subject holds no relation on the entity', async () => {
      const rpc = jest.fn().mockResolvedValue({ tuples: [] });
      const service = buildWithReads(rpc);

      await expect(
        service.readRelationships({
          entity: { type: 'team', id: 'team-1' },
          subject: { type: 'user', id: 'user-1' },
        }),
      ).resolves.toEqual([]);
    });

    it('wraps a Permify failure the same way the other data calls do', async () => {
      const rpc = jest.fn().mockRejectedValue(new Error('unavailable'));
      const service = buildWithReads(rpc);

      await expect(
        service.readRelationships({
          entity: { type: 'team', id: 'team-1' },
          subject: { type: 'user', id: 'user-1' },
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('setOrganizationProductAttributes', () => {
    it('writes the three product attributes of the organisation in ONE write', async () => {
      const write = jest.fn().mockResolvedValue({ snapToken: 's1' });
      const service = build({
        data: {
          write,
          readAttributes: jest.fn(),
          readRelationships: jest.fn(),
          writeRelationships: jest.fn(),
          deleteRelationships: jest.fn(),
        },
      });

      await expect(
        service.setOrganizationProductAttributes('o1', {
          is_active: false,
          writes_blocked: false,
          vibedefend_active: false,
        }),
      ).resolves.toBe(true);

      expect(write).toHaveBeenCalledTimes(1);
      const request = write.mock.calls[0][0];
      expect(request.metadata).toEqual({ schemaVersion: 'v1' });
      expect(
        request.attributes.map((a: { entity: unknown; attribute: string }) => [
          a.entity,
          a.attribute,
        ]),
      ).toEqual([
        [{ type: 'organization', id: 'o1' }, 'is_active'],
        [{ type: 'organization', id: 'o1' }, 'writes_blocked'],
        [{ type: 'organization', id: 'o1' }, 'vibedefend_active'],
      ]);
    });

    it('refuses an empty organisation id before any RPC', async () => {
      const write = jest.fn();
      const service = build({
        data: {
          write,
          readAttributes: jest.fn(),
          readRelationships: jest.fn(),
          writeRelationships: jest.fn(),
          deleteRelationships: jest.fn(),
        },
      });

      await expect(
        service.setOrganizationProductAttributes('', {
          is_active: false,
          writes_blocked: false,
          vibedefend_active: false,
        }),
      ).rejects.toThrow();
      expect(write).not.toHaveBeenCalled();
    });

    it('wraps a Permify failure the same way the other data calls do', async () => {
      const write = jest.fn().mockRejectedValue(new Error('boom'));
      const service = build({
        data: {
          write,
          readAttributes: jest.fn(),
          readRelationships: jest.fn(),
          writeRelationships: jest.fn(),
          deleteRelationships: jest.fn(),
        },
      });

      await expect(
        service.setOrganizationProductAttributes('o1', {
          is_active: false,
          writes_blocked: false,
          vibedefend_active: false,
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  /**
   * Per-member products (schema 1.5.0): a member's products are two relations
   * on the organisation, `appsec_user` and `vibedefend_user`, enforced once the
   * organisation's attribute `member_products` is on.
   */
  describe('per-member products (schema 1.5.0)', () => {
    const buildData = () => {
      const data = {
        write: jest.fn().mockResolvedValue({ snapToken: 's1' }),
        readAttributes: jest.fn(),
        readRelationships: jest.fn(),
        writeRelationships: jest.fn().mockResolvedValue({ snapToken: 's1' }),
        deleteRelationships: jest.fn().mockResolvedValue({ snapToken: 's1' }),
      };
      return { data, service: build({ data }) };
    };
    const tuple = (relation: string, userId: string) => ({
      entity: { type: 'organization', id: 'o1' },
      relation,
      subject: { type: 'user', id: userId },
    });
    const deletion = (relation: string) => ({
      tenantId: 't1',
      filter: {
        entity: { type: 'organization', ids: ['o1'] },
        relation,
        subject: { type: 'user', ids: ['u1'] },
      },
    });

    describe('writeMemberProductTuples: the two relations match the products exactly', () => {
      it('both products: one write of the two tuples, nothing deleted', async () => {
        const { data, service } = buildData();

        await service.writeMemberProductTuples('o1', 'u1', [
          'appsec',
          'vibedefend',
        ]);

        expect(data.writeRelationships).toHaveBeenCalledTimes(1);
        expect(data.writeRelationships.mock.calls[0][0]).toEqual({
          tenantId: 't1',
          metadata: { schemaVersion: 'v1' },
          tuples: [tuple('appsec_user', 'u1'), tuple('vibedefend_user', 'u1')],
        });
        expect(data.deleteRelationships).not.toHaveBeenCalled();
      });

      it('second product only: writes its relation and deletes appsec_user', async () => {
        const { data, service } = buildData();

        await service.writeMemberProductTuples('o1', 'u1', ['vibedefend']);

        expect(data.writeRelationships.mock.calls[0][0].tuples).toEqual([
          tuple('vibedefend_user', 'u1'),
        ]);
        expect(data.deleteRelationships).toHaveBeenCalledTimes(1);
        expect(data.deleteRelationships.mock.calls[0][0]).toEqual(
          deletion('appsec_user'),
        );
      });

      it('no product: writes nothing and deletes both relations, never the role', async () => {
        const { data, service } = buildData();

        await service.writeMemberProductTuples('o1', 'u1', []);

        expect(data.writeRelationships).not.toHaveBeenCalled();
        expect(
          data.deleteRelationships.mock.calls.map(([request]) => request),
        ).toEqual([deletion('appsec_user'), deletion('vibedefend_user')]);
      });

      // A microservice throws RpcException with a
      // gRPC status, never an HttpException.
      it('turns a Permify failure into RpcException INTERNAL, never an HttpException', async () => {
        const { data, service } = buildData();
        data.writeRelationships.mockRejectedValue(new Error('boom'));

        const thrown = await service
          .writeMemberProductTuples('o1', 'u1', ['appsec'])
          .catch((e: unknown) => e);

        expect(thrown).toBeInstanceOf(RpcException);
        expect((thrown as RpcException).getError()).toEqual({
          code: status.INTERNAL,
          message: 'Error while writing member product tuples',
        });
      });

      it('refuses an empty organisation or member: RpcException INVALID_ARGUMENT, no RPC', async () => {
        const { data, service } = buildData();

        for (const [organizationId, userId] of [
          ['', 'u1'],
          ['o1', ''],
        ]) {
          const thrown = await service
            .writeMemberProductTuples(organizationId, userId, ['appsec'])
            .catch((e: unknown) => e);
          expect(thrown).toBeInstanceOf(RpcException);
          expect(
            ((thrown as RpcException).getError() as { code: number }).code,
          ).toBe(status.INVALID_ARGUMENT);
        }
        expect(data.writeRelationships).not.toHaveBeenCalled();
      });
    });

    describe('grantProductTuples: one product to many members', () => {
      it('writes by batches of 100 tuples', async () => {
        const { data, service } = buildData();
        const userIds = Array.from({ length: 250 }, (_, i) => `u${i}`);

        await service.grantProductTuples('o1', 'appsec', userIds);

        const batches = data.writeRelationships.mock.calls.map(
          ([request]) => request.tuples,
        );
        expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
        expect(batches.flat()).toEqual(
          userIds.map((id) => tuple('appsec_user', id)),
        );
        expect(data.deleteRelationships).not.toHaveBeenCalled();
      });

      it('sends nothing for no member', async () => {
        const { data, service } = buildData();

        await service.grantProductTuples('o1', 'vibedefend', []);

        expect(data.writeRelationships).not.toHaveBeenCalled();
      });

      // A later batch failing leaves the earlier
      // ones written; a retry writes every batch again (a tuple that exists
      // is written again, unchanged).
      it('a failed batch answers RpcException; a retry writes every batch again', async () => {
        const { data, service } = buildData();
        const userIds = Array.from({ length: 150 }, (_, i) => `u${i}`);
        data.writeRelationships
          .mockResolvedValueOnce({ snapToken: 's1' })
          .mockRejectedValueOnce(new Error('boom'));

        const thrown = await service
          .grantProductTuples('o1', 'vibedefend', userIds)
          .catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(RpcException);
        expect(
          ((thrown as RpcException).getError() as { code: number }).code,
        ).toBe(status.INTERNAL);

        data.writeRelationships.mockClear();
        await service.grantProductTuples('o1', 'vibedefend', userIds);

        expect(
          data.writeRelationships.mock.calls
            .map(([request]) => request.tuples)
            .flat(),
        ).toEqual(userIds.map((id) => tuple('vibedefend_user', id)));
      });
    });

    describe('setMemberProductsSwitch', () => {
      it.each([true, false])(
        'writes member_products = %s alone',
        async (on) => {
          const { data, service } = buildData();
          const encode = jest.spyOn(permify.grpc.base.BooleanValue, 'encode');

          await expect(service.setMemberProductsSwitch('o1', on)).resolves.toBe(
            true,
          );

          expect(data.write).toHaveBeenCalledTimes(1);
          const request = data.write.mock.calls[0][0];
          expect(request.metadata).toEqual({ schemaVersion: 'v1' });
          expect(request.tuples).toEqual([]);
          expect(
            request.attributes.map(
              (a: { entity: unknown; attribute: string }) => [
                a.entity,
                a.attribute,
              ],
            ),
          ).toEqual([[{ type: 'organization', id: 'o1' }, 'member_products']]);
          expect(encode).toHaveBeenCalledWith({ data: on });
          encode.mockRestore();
        },
      );

      it('refuses an empty organisation id before any RPC: RpcException INVALID_ARGUMENT', async () => {
        const { data, service } = buildData();

        const thrown = await service
          .setMemberProductsSwitch('', true)
          .catch((e: unknown) => e);

        expect(thrown).toBeInstanceOf(RpcException);
        expect(
          ((thrown as RpcException).getError() as { code: number }).code,
        ).toBe(status.INVALID_ARGUMENT);
        expect(data.write).not.toHaveBeenCalled();
      });

      it('answers false, never true, when Permify returns no snap token', async () => {
        const { data, service } = buildData();
        data.write.mockResolvedValue({ snapToken: '' });

        await expect(service.setMemberProductsSwitch('o1', true)).resolves.toBe(
          false,
        );
      });

      it('turns a Permify failure into RpcException INTERNAL', async () => {
        const { data, service } = buildData();
        data.write.mockRejectedValue(new Error('boom'));

        const thrown = await service
          .setMemberProductsSwitch('o1', true)
          .catch((e: unknown) => e);

        expect(thrown).toBeInstanceOf(RpcException);
        expect(
          ((thrown as RpcException).getError() as { code: number }).code,
        ).toBe(status.INTERNAL);
      });
    });

    it('setOrganizationProductAttributes also writes member_products when it is given', async () => {
      const { data, service } = buildData();

      await service.setOrganizationProductAttributes('o1', {
        is_active: false,
        writes_blocked: false,
        vibedefend_active: false,
        member_products: true,
      });

      expect(data.write).toHaveBeenCalledTimes(1);
      expect(
        data.write.mock.calls[0][0].attributes.map(
          (a: { attribute: string }) => a.attribute,
        ),
      ).toEqual([
        'is_active',
        'writes_blocked',
        'vibedefend_active',
        'member_products',
      ]);
    });
  });

  describe('deleteOrganizationAttributes (data purge)', () => {
    const ORG = '55555555-5555-4555-8555-555555555555';
    const clientWithDelete = (del: jest.Mock) =>
      ({
        data: { delete: del },
      }) as unknown as Partial<PermifyClientMock>;

    it('names the organization in both filters', async () => {
      const del = jest.fn().mockResolvedValue({ snapToken: 's1' });
      const service = build(clientWithDelete(del));

      await service.deleteOrganizationAttributes(ORG);

      expect(del).toHaveBeenCalledTimes(1);
      const [request] = del.mock.calls[0];
      expect(request.tenantId).toBe('t1');
      expect(request.tupleFilter.entity).toEqual({
        type: 'organization',
        ids: [ORG],
      });
      expect(request.attributeFilter.entity).toEqual({
        type: 'organization',
        ids: [ORG],
      });
      // Proven on a real Permify v1.6.10 by permify.purge.live.spec.ts: an
      // empty list deletes every attribute of that one organization, and an
      // empty relation every relationship it holds.
      expect(request.attributeFilter.attributes).toEqual([]);
      expect(request.tupleFilter.relation).toBe('');
    });

    it.each([
      ['an empty id', ''],
      ['a wildcard', '*'],
      ['a path', '../t1'],
      ['undefined', undefined as unknown as string],
    ])(
      'refuses %s and never sends a filter',
      async (_label, organizationId) => {
        const del = jest.fn().mockResolvedValue({ snapToken: 's1' });
        const service = build(clientWithDelete(del));

        await expect(
          service.deleteOrganizationAttributes(organizationId),
        ).rejects.toMatchObject({
          error: expect.objectContaining({ code: status.INVALID_ARGUMENT }),
        });
        expect(del).not.toHaveBeenCalled();
      },
    );

    it('never sends a filter whose entity names no organization', async () => {
      // An empty filter would delete every tenant's data: whatever happens,
      // each filter carries exactly the organization asked for.
      const del = jest.fn().mockResolvedValue({ snapToken: 's1' });
      const service = build(clientWithDelete(del));

      await service.deleteOrganizationAttributes(ORG);

      const [request] = del.mock.calls[0];
      for (const filter of [request.tupleFilter, request.attributeFilter]) {
        expect(filter).toBeDefined();
        expect(filter.entity.type).toBe('organization');
        expect(filter.entity.ids).toEqual([ORG]);
      }
    });

    it('is UNAVAILABLE when Permify is unreachable, INTERNAL otherwise', async () => {
      const unreachable = jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('x'), { code: 14 }));
      await expect(
        build(clientWithDelete(unreachable)).deleteOrganizationAttributes(ORG),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.UNAVAILABLE }),
      });

      const broken = jest.fn().mockRejectedValue(new Error('bad schema'));
      await expect(
        build(clientWithDelete(broken)).deleteOrganizationAttributes(ORG),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.INTERNAL }),
      });
    });
  });

  describe('the shared deadline helper', () => {
    it('defaults to a 2 s budget', () => {
      jest.useFakeTimers();
      const options = permifyCallOptions(resolvePermifyDeadlineMs(undefined));

      expect(options.signal).toBeInstanceOf(AbortSignal);
      jest.advanceTimersByTime(1999);
      expect(options.signal.aborted).toBe(false);
      jest.advanceTimersByTime(1);
      expect(options.signal.aborted).toBe(true);
    });

    it('honours PERMIFY_RPC_DEADLINE_MS', () => {
      jest.useFakeTimers();
      const options = permifyCallOptions(resolvePermifyDeadlineMs('500'));

      jest.advanceTimersByTime(499);
      expect(options.signal.aborted).toBe(false);
      jest.advanceTimersByTime(1);
      expect(options.signal.aborted).toBe(true);
    });

    it('refuses a NaN or non-positive override, which would abort instantly', () => {
      expect(resolvePermifyDeadlineMs('nonsense')).toBe(2000);
      expect(resolvePermifyDeadlineMs('0')).toBe(2000);
      expect(resolvePermifyDeadlineMs('-1')).toBe(2000);
    });
  });
});
