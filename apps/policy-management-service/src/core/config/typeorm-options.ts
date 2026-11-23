import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';
import SecretsService from '../secrets/secrets.service';

type PostgresOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

/**
 * Explicit pool size per process.
 *
 * Without it, both the service and the worker run on node-postgres' default of
 * 10 connections, multiplied by replicas. 5 is comfortably above the
 * per-process concurrency, bounds what a scale-up can take, and keeps a shared
 * PostgreSQL within its connection budget.
 */
export const POLICY_DB_POOL_MAX = 5;

/** Return an idle connection to the instance rather than holding it open. */
export const POLICY_DB_IDLE_TIMEOUT_MS = 30_000;

/**
 * The parts that genuinely differ between the API process and the worker: the
 * API loads entities by glob and runs migrations, the worker takes the three
 * entity classes it needs and never migrates.
 */
export interface PolicyTypeOrmOverrides {
  entities: PostgresOptions['entities'];
  migrations?: PostgresOptions['migrations'];
  migrationsRun?: boolean;
  autoLoadEntities?: boolean;
}

/**
 * Single source of truth for the Postgres connection of both `app.module` and
 * `worker.module`. They carried two copies of this factory, which is how the
 * pool came to be missing from both.
 */
export async function buildPolicyTypeOrmOptions(
  secretsService: SecretsService,
  configService: ConfigService,
  overrides: PolicyTypeOrmOverrides,
): Promise<TypeOrmModuleOptions> {
  await secretsService.ensureCacheLoaded();

  const host = secretsService.getSecret('DB_HOST');
  const portStr = secretsService.getSecret('DB_PORT');
  const username = secretsService.getSecret('DB_USERNAME');
  const password = secretsService.getSecret('DB_PASSWORD');
  const database = secretsService.getSecret('DB_DATABASE');

  if (!host || !portStr || !username || !password || !database) {
    throw new TypeError(
      'Cannot get database connection parameters from secrets',
    );
  }

  const port = Number(portStr);
  if (Number.isNaN(port)) {
    throw new TypeError(`Invalid port number`);
  }

  const sslEnabled =
    String(configService.get<string>('DB_SSL_ENABLED')) === 'true';

  const sslOptions = sslEnabled
    ? {
        ca: secretsService.getSecret('DB_SSL_CA_CERT'),
        // The certificate chain IS verified: a server presenting a
        // certificate signed by another authority than the configured CA is
        // rejected.
        rejectUnauthorized: true,
        // Hostname verification, however, is disabled. Some managed providers
        // issue server certificates without a SubjectAltName for the host,
        // and a connection by private IP can match no name at all, so
        // node-postgres would refuse every connection. The CA pin still
        // applies.
        //
        // The MySQL services need no such override: mysql2 does not verify
        // the hostname, only node-postgres does.
        checkServerIdentity: () => undefined,
      }
    : undefined;

  // Fail at boot when TLS is on and the CA is missing, as the MySQL services
  // do: starting with ca: undefined loops TypeORM restarts instead of giving a
  // clear message. The worker also scales to zero, so without this check a
  // missing certificate would only show at the next scale-up, under load.
  if (sslEnabled && !sslOptions?.ca) {
    throw new TypeError(
      'DB_SSL_ENABLED=true but DB_SSL_CA_CERT is missing from secrets',
    );
  }

  return {
    type: 'postgres',
    host,
    port,
    username,
    password,
    database,
    ssl: sslOptions,
    synchronize: false,
    logging: configService.get<string>('NODE_ENV') === 'development',
    extra: {
      max: POLICY_DB_POOL_MAX,
      idleTimeoutMillis: POLICY_DB_IDLE_TIMEOUT_MS,
    },
    ...overrides,
  };
}
