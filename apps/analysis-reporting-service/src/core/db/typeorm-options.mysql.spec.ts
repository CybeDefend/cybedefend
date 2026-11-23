import type { ConfigService } from '@nestjs/config';
import type SecretsService from '../secrets/secrets.service';
import { DB_POOL_SIZE, resolveDbConnection } from './typeorm-options';

type SecretsLike = Pick<SecretsService, 'ensureCacheLoaded' | 'getSecret'>;
type ConfigLike = Pick<ConfigService, 'get'>;

const secretsOf = (map: Record<string, string | undefined>): SecretsLike => ({
  ensureCacheLoaded: () => Promise.resolve(),
  getSecret: (key: string) => map[key],
});

const configOf = (values: Record<string, string | undefined>): ConfigLike => ({
  get: (key: string) => values[key],
});

describe('resolveDbConnection (today’s secret reads, moved unchanged)', () => {
  const BASE_SECRETS = {
    DB_HOST: 'h',
    DB_PORT: '3306',
    DB_USERNAME: 'u',
    DB_PASSWORD: 'p',
    DB_DATABASE: 'd',
  };

  it('throws when a connection parameter is missing', async () => {
    await expect(
      resolveDbConnection(secretsOf({ DB_HOST: 'h' }), configOf({})),
    ).rejects.toThrow('Cannot get database connection parameters from secrets');
  });

  it('throws on a non-numeric port, naming it', async () => {
    await expect(
      resolveDbConnection(
        secretsOf({ ...BASE_SECRETS, DB_PORT: 'not-a-port' }),
        configOf({}),
      ),
    ).rejects.toThrow('Invalid port number: not-a-port');
  });

  it('reads host, port, credentials, database and NODE_ENV', async () => {
    const conn = await resolveDbConnection(
      secretsOf({ ...BASE_SECRETS, DB_PORT: '3307' }),
      configOf({ NODE_ENV: 'production', DB_SSL_ENABLED: 'false' }),
    );
    expect(conn).toEqual({
      host: 'h',
      port: 3307,
      username: 'u',
      password: 'p',
      database: 'd',
      ssl: undefined,
      nodeEnv: 'production',
    });
  });

  it('requires the CA when SSL is enabled', async () => {
    await expect(
      resolveDbConnection(
        secretsOf(BASE_SECRETS),
        configOf({ DB_SSL_ENABLED: 'true' }),
      ),
    ).rejects.toThrow(
      'DB_SSL_ENABLED=true but DB_SSL_CA_CERT is missing from secrets',
    );
  });

  it('keeps the client cert and key only when both are set', async () => {
    const caOnly = await resolveDbConnection(
      secretsOf({ ...BASE_SECRETS, DB_SSL_CA_CERT: 'ca' }),
      configOf({ DB_SSL_ENABLED: 'true' }),
    );
    expect(caOnly.ssl).toEqual({ ca: 'ca' });
    const full = await resolveDbConnection(
      secretsOf({
        ...BASE_SECRETS,
        DB_SSL_CA_CERT: 'ca',
        DB_SSL_CLIENT_CERT: 'cert',
        DB_SSL_CLIENT_KEY: 'key',
      }),
      configOf({ DB_SSL_ENABLED: 'true' }),
    );
    expect(full.ssl).toEqual({ ca: 'ca', cert: 'cert', key: 'key' });
    const half = await resolveDbConnection(
      secretsOf({
        ...BASE_SECRETS,
        DB_SSL_CA_CERT: 'ca',
        DB_SSL_CLIENT_CERT: 'cert',
      }),
      configOf({ DB_SSL_ENABLED: 'true' }),
    );
    expect(half.ssl).toEqual({ ca: 'ca' });
  });
});

// The cases that build the MySQL options are not here: the Community Edition
// refuses mysql.
describe('buildTypeOrmOptions on mysql', () => {
  it('the pool sizes are the MySQL connectionLimit of each context, else 10', () => {
    expect(DB_POOL_SIZE).toEqual({
      api: 20,
      worker: 24,
      'worker-reports': 5,
      'cron-report-mail': 10,
      'cron-report-retention': 10,
      'cron-osv': 16,
      'cron-epss': 10,
      'worker-autofix': 10,
      cli: 10,
      live: 20,
    });
  });
});
