import type { ConfigService } from '@nestjs/config';
import type SecretsService from '../secrets/secrets.service';
import { resolveDbConnection } from './typeorm-options';

const BASE_SECRETS: Record<string, string> = {
  DB_HOST: 'db.internal',
  DB_PORT: '3306',
  DB_USERNAME: 'fm',
  DB_PASSWORD: 'pw',
  DB_DATABASE: 'cybedefend_file_management',
};

function secrets(extra: Record<string, string> = {}) {
  return {
    ensureCacheLoaded: async () => undefined,
    getSecret: (key: string) => ({ ...BASE_SECRETS, ...extra })[key],
  } as Pick<SecretsService, 'ensureCacheLoaded' | 'getSecret'>;
}

function config(env: Record<string, string>) {
  return {
    get: (key: string) => env[key],
  } as unknown as Pick<ConfigService, 'get'>;
}

// The cases that build the MySQL options (the Community Edition refuses mysql)
// are tested with the closed edition.
describe('buildTypeOrmOptions on mysql returns exactly today’s object', () => {
  it('keeps the TypeError messages of today’s factory', async () => {
    await expect(
      resolveDbConnection(
        {
          ensureCacheLoaded: async () => undefined,
          getSecret: () => undefined,
        },
        config({}),
      ),
    ).rejects.toThrow('Cannot get database connection parameters from secrets');
    await expect(
      resolveDbConnection(
        secrets({ DB_PORT: 'not-a-port' }),
        config({ NODE_ENV: 'production' }),
      ),
    ).rejects.toThrow('Invalid port number');
    await expect(
      resolveDbConnection(
        secrets(),
        config({ NODE_ENV: 'production', DB_SSL_ENABLED: 'true' }),
      ),
    ).rejects.toThrow(
      'DB_SSL_ENABLED=true but DB_SSL_CA_CERT is missing from secrets',
    );
  });
});
