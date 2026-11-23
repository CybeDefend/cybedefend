/**
 * Module-level spec for `RedisModule`.
 *
 * Focus: the shared `REDIS_CLIENT` token is provided AND exported, so any
 * module can consume it without re-declaring the factory locally. This is the
 * exact class of bug to guard against: a missing provider still
 * compiles and passes unit tests (the client is mocked there) but crashes
 * bootstrap with `UnknownDependenciesException`. Standing up a real Nest DI
 * graph here is what actually catches it.
 *
 * `ioredis` is mocked so no real connection is opened — same technique as
 * `mcp-service/src/modules/mcp/mcp.module.spec.ts`.
 */

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    quit: jest.fn(async () => 'OK'),
  })),
);

import { Inject, Injectable, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';

import { REDIS_CLIENT, RedisModule } from './redis.module';

/** Stand-in for a real feature service that needs Redis. */
@Injectable()
class ConsumerService {
  constructor(@Inject(REDIS_CLIENT) public readonly redis: Redis) {}
}

@Module({
  imports: [RedisModule],
  providers: [ConsumerService],
})
class ConsumerModule {}

function makeModule(env: Record<string, string | undefined>) {
  return Test.createTestingModule({
    imports: [
      // Hermetic config: no `.env` file, no ambient `process.env` leakage.
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [() => env],
      }),
      ConsumerModule,
    ],
  }).compile();
}

describe('RedisModule', () => {
  const RedisMock = jest.requireMock('ioredis') as jest.Mock;

  beforeEach(() => {
    RedisMock.mockClear();
  });

  it('exposes REDIS_CLIENT as the literal string token used by existing modules', () => {
    // Existing call sites inject `'REDIS_CLIENT'` as a raw string; the exported
    // constant must stay value-identical so this module is a drop-in provider.
    expect(REDIS_CLIENT).toBe('REDIS_CLIENT');
  });

  it('provides REDIS_CLIENT built from REDIS_URL', async () => {
    const mod = await makeModule({ REDIS_URL: 'redis://localhost:6379' });

    expect(mod.get(REDIS_CLIENT)).toBeDefined();
    expect(RedisMock).toHaveBeenCalledWith('redis://localhost:6379');
  });

  it('exports REDIS_CLIENT so an importing module can inject it', async () => {
    const mod = await makeModule({ REDIS_URL: 'redis://localhost:6379' });

    const consumer = mod.get(ConsumerService);
    expect(consumer.redis).toBeDefined();
    expect(consumer.redis).toBe(mod.get(REDIS_CLIENT));
  });

  it('fails fast when REDIS_URL is not configured', async () => {
    // Parity with the pre-existing gitlab.module factory: no silent
    // localhost fallback that would connect to the wrong Redis in prod.
    await expect(makeModule({})).rejects.toThrow(/REDIS_URL/);
  });
});
