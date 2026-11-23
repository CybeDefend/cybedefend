/**
 * Real-deadline regression test for the Permify call deadline.
 *
 * Deliberately does NOT mock `@permify/permify-node`: the whole point is that
 * the deadline survives the real nice-grpc client. A saturated Permify must not
 * make every guarded request hang and then 500: the guard gives up fast and
 * answers 503.
 *
 * Note for anyone extending this: nice-grpc (the transport inside
 * @permify/permify-node) silently IGNORES a grpc-js `deadline` call option — it
 * only reads `{ metadata, signal, onHeader, onTrailer }` and never passes a
 * grpc-js CallOptions object to `makeUnaryRequest`. `signal` is the only
 * mechanism that actually bounds a call.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import {
  Server,
  ServerCredentials,
  type UntypedServiceImplementation,
} from '@grpc/grpc-js';
import {
  PermissionCheckRequest,
  PermissionCheckResponse,
} from '@permify/permify-node/dist/src/grpc/generated/base/v1/service';
import type { ExecutionContext } from '@nestjs/common';
import SecretsService from 'src/core/secrets/secrets.service';
import { PermissionsGuard } from './permissions.guard';

/**
 * A `base.v1.Permission/Check` whose handler never calls back: it models a
 * Permify that has accepted the RPC and is stuck waiting on its Postgres pool.
 */
const stuckPermissionService = {
  check: {
    path: '/base.v1.Permission/Check',
    requestStream: false,
    responseStream: false,
    requestSerialize: (value: PermissionCheckRequest): Buffer =>
      Buffer.from(PermissionCheckRequest.encode(value).finish()),
    requestDeserialize: (bytes: Buffer): PermissionCheckRequest =>
      PermissionCheckRequest.decode(bytes),
    responseSerialize: (value: PermissionCheckResponse): Buffer =>
      Buffer.from(PermissionCheckResponse.encode(value).finish()),
    responseDeserialize: (bytes: Buffer): PermissionCheckResponse =>
      PermissionCheckResponse.decode(bytes),
  },
};

describe('PermissionsGuard — real gRPC deadline', () => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    server = new Server();
    server.addService(stuckPermissionService, {
      check: () => {
        /* never calls back — the request hangs for as long as the client lets it */
      },
    } as unknown as UntypedServiceImplementation);
    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync(
        '127.0.0.1:0',
        ServerCredentials.createInsecure(),
        (err, boundPort) => (err ? reject(err) : resolve(boundPort)),
      );
    });
    endpoint = `127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.forceShutdown();
  });

  it('gives up within its deadline and answers 503 instead of hanging', async () => {
    const values: Record<string, string> = {
      PERMIFY_ENDPOINT: endpoint,
      PERMIFY_SCHEMA_VERSION: 'v1',
      PERMIFY_RPC_DEADLINE_MS: '300',
    };
    const config = {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
    const reflector = {
      get: jest
        .fn()
        .mockReturnValueOnce(['organization'])
        .mockReturnValueOnce(['read']),
    } as unknown as Reflector;
    const secrets = {
      getSecret: jest.fn(() => 'v1'),
    } as unknown as SecretsService;
    const logger = { error: jest.fn() } as unknown as Logger;

    const guard = new PermissionsGuard(reflector, config, secrets, logger);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          params: { organizationId: 'o1' },
          user: { sub: 'u1' },
        }),
      }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;

    const startedAt = Date.now();
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const elapsed = Date.now() - startedAt;

    // Before the fix this call hung until the socket died. Generous upper bound
    // so a loaded CI box cannot flake it, but far below the 8-25s we observed.
    expect(elapsed).toBeLessThan(1000);
    // And it really did wait for the deadline: a bind failure or a wrong
    // endpoint would also give a fast 503, and this test would quietly stop
    // testing anything. 250 ms leaves slack under the 300 ms deadline for
    // timer coarseness without admitting an instant failure.
    expect(elapsed).toBeGreaterThanOrEqual(250);
  });
});
