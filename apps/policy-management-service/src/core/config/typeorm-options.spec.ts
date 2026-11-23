import { ConfigService } from '@nestjs/config';
import SecretsService from '../secrets/secrets.service';
import {
  buildPolicyTypeOrmOptions,
  POLICY_DB_IDLE_TIMEOUT_MS,
  POLICY_DB_POOL_MAX,
} from './typeorm-options';

/**
 * Both the service and the worker set an explicit Postgres pool: without it,
 * node-postgres opens up to 10 connections per process, multiplied by
 * replicas, on a database other services share.
 */
describe('buildPolicyTypeOrmOptions', () => {
  const secrets = (
    overrides: Record<string, string | undefined> = {},
  ): SecretsService => {
    const values: Record<string, string | undefined> = {
      DB_HOST: 'db.internal',
      DB_PORT: '5432',
      DB_USERNAME: 'policy_user',
      DB_PASSWORD: 'policy_password',
      DB_DATABASE: 'cybedefend_policy',
      ...overrides,
    };
    return {
      ensureCacheLoaded: jest.fn().mockResolvedValue(undefined),
      getSecret: jest.fn((key: string) => values[key]),
    } as unknown as SecretsService;
  };

  const config = (
    values: Record<string, string> = { NODE_ENV: 'production' },
  ): ConfigService =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService;

  const serviceOverrides = {
    entities: ['/app/dist/entities/**/*.entity.js'],
    migrations: ['/app/dist/core/migrations/*.js'],
    migrationsRun: true,
    autoLoadEntities: true,
  };
  const workerOverrides = { entities: [class SecurityPolicy {}] };

  it.each([
    ['service', serviceOverrides],
    ['worker', workerOverrides],
  ])(
    'gives the %s data source an explicit pool of 5',
    async (_l, overrides) => {
      const options = (await buildPolicyTypeOrmOptions(
        secrets(),
        config(),
        overrides,
      )) as { extra?: Record<string, unknown> };

      expect(options.extra?.max).toBe(5);
      expect(options.extra?.idleTimeoutMillis).toBe(30000);
    },
  );

  it('exports the pool constants it applies', () => {
    expect(POLICY_DB_POOL_MAX).toBe(5);
    expect(POLICY_DB_IDLE_TIMEOUT_MS).toBe(30000);
  });

  it('keeps the caller’s entities, migrations and Nest-only options', async () => {
    const options = (await buildPolicyTypeOrmOptions(
      secrets(),
      config(),
      serviceOverrides,
    )) as Record<string, unknown>;

    expect(options.type).toBe('postgres');
    expect(options.host).toBe('db.internal');
    expect(options.port).toBe(5432);
    expect(options.database).toBe('cybedefend_policy');
    expect(options.synchronize).toBe(false);
    expect(options.entities).toEqual(serviceOverrides.entities);
    expect(options.migrations).toEqual(serviceOverrides.migrations);
    expect(options.migrationsRun).toBe(true);
    expect(options.autoLoadEntities).toBe(true);
  });

  it('does not run migrations from the worker-shaped call', async () => {
    const options = (await buildPolicyTypeOrmOptions(
      secrets(),
      config(),
      workerOverrides,
    )) as Record<string, unknown>;

    expect(options.migrations).toBeUndefined();
    expect(options.migrationsRun).toBeUndefined();
  });

  it('still refuses to start on incomplete connection secrets', async () => {
    await expect(
      buildPolicyTypeOrmOptions(
        secrets({ DB_HOST: undefined }),
        config(),
        workerOverrides,
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('still refuses TLS without a CA certificate', async () => {
    await expect(
      buildPolicyTypeOrmOptions(
        secrets({ DB_SSL_CA_CERT: undefined }),
        config({ NODE_ENV: 'production', DB_SSL_ENABLED: 'true' }),
        workerOverrides,
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
