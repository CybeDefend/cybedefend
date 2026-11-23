import * as net from 'node:net';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type Redis from 'ioredis';

import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import {
  GATEWAY_REDIS_COMMAND_TIMEOUT_MS,
  createGatewayRedisClient,
} from './gateway-redis-client';

/**
 * A peer that accepts the connection and never answers: what a client sees
 * when its connection outlives the Redis pod behind it (a half-open socket),
 * or when a connection never reaches `ready`.
 */
function silentPeer(): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        url: `redis://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

function guardedRequest(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ip: '203.0.113.9',
        headers: {},
        user: { sub: 'u1' },
      }),
      getResponse: () => ({ raw: { setHeader: jest.fn() } }),
    }),
  } as unknown as ExecutionContext;
}

/**
 * The shared client has a command timeout. Without one, on a Redis that
 * never answers, a guarded request waits forever and logs nothing; the
 * caller's own timeout fires first.
 */
describe('createGatewayRedisClient', () => {
  let peer: { url: string; close: () => Promise<void> };
  let redis: Redis;

  beforeEach(async () => {
    peer = await silentPeer();
    redis = createGatewayRedisClient(peer.url);
  });

  afterEach(async () => {
    redis.disconnect();
    await peer.close();
  });

  it('bounds every command at about a second', () => {
    expect(GATEWAY_REDIS_COMMAND_TIMEOUT_MS).toBe(1_000);
    expect(redis.options.commandTimeout).toBe(GATEWAY_REDIS_COMMAND_TIMEOUT_MS);
  });

  it('rejects a command to a Redis that never answers in about a second', async () => {
    const started = Date.now();

    await expect(redis.get('any')).rejects.toThrow('Command timed out');

    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(
      GATEWAY_REDIS_COMMAND_TIMEOUT_MS - 50,
    );
    expect(waited).toBeLessThan(3_000);
  }, 15_000);

  /**
   * RateLimitGuard no longer fails the request when Redis does not
   * answer. It counts it in-process (redis-rate-limit.ts), still fast.
   */
  it('turns a silent Redis into a fast in-process answer of RateLimitGuard, not a hang', async () => {
    const guard = new RateLimitGuard(
      new Reflector(),
      new ConfigService(),
      redis,
    );
    const started = Date.now();

    await expect(guard.canActivate(guardedRequest())).resolves.toBe(true);

    expect(Date.now() - started).toBeLessThan(3_000);
  }, 15_000);
});
