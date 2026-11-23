/**
 * Module-level spec for `McpModule`.
 *
 * Focus: the `SESSION_STORE` factory picks the right backend based on
 * `REDIS_URL`. We stand up a real Nest DI graph with a fake `ConfigService`
 * that returns the env we want, then resolve the `SESSION_STORE` provider
 * and assert its concrete class.
 *
 * We do NOT boot `AppModule` here (too much surface for this one assertion).
 * `McpModule` is imported directly with a `ConfigService` override.
 */

// Mock ioredis to keep this hermetic — the factory returning a
// RedisSessionStore should not open a real connection.
const quitMock = jest.fn(async () => 'OK');
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn(async () => 'OK'),
    get: jest.fn(async () => null),
    del: jest.fn(async () => 1),
    quit: quitMock,
    on: jest.fn(),
  }));
});

import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';

import { McpModule } from './mcp.module';
import { SESSION_STORE } from './session/session-store.interface';
import { InMemorySessionStore } from './session/session.store';
import { RedisSessionStore } from './session/redis.session-store';

describe('McpModule — session-store factory', () => {
  async function makeModule(env: Record<string, string | undefined>) {
    return Test.createTestingModule({
      imports: [
        // Inline config load keeps this hermetic (no .env file).
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          // McpModule imports GatewayClientModule (agent-session reports),
          // whose client refuses to boot without a Gateway URL.
          load: [
            () => ({ CYBEDEFEND_API_RESOURCE: 'http://gateway.local', ...env }),
          ],
        }),
        LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
        McpModule,
      ],
    }).compile();
  }

  it('returns InMemorySessionStore when REDIS_URL is absent', async () => {
    const mod = await makeModule({});
    const store = mod.get(SESSION_STORE);
    expect(store).toBeInstanceOf(InMemorySessionStore);
    (store as InMemorySessionStore).stop();
  });

  it('returns InMemorySessionStore when REDIS_URL is an empty string', async () => {
    const mod = await makeModule({ REDIS_URL: '   ' });
    const store = mod.get(SESSION_STORE);
    expect(store).toBeInstanceOf(InMemorySessionStore);
    (store as InMemorySessionStore).stop();
  });

  it('returns RedisSessionStore when REDIS_URL is set', async () => {
    const mod = await makeModule({ REDIS_URL: 'redis://localhost:6379' });
    const store = mod.get(SESSION_STORE);
    expect(store).toBeInstanceOf(RedisSessionStore);
    await (store as RedisSessionStore).stop();
  });
});
