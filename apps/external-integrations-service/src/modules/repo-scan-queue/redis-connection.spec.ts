import { ConfigService } from '@nestjs/config';
import { buildRedisConnection } from './redis-connection';

const config = (env: Record<string, string | undefined>) =>
  new ConfigService(env);

describe('buildRedisConnection', () => {
  it('takes the password from REDIS_URL', () => {
    expect(
      buildRedisConnection(config({ REDIS_URL: 'redis://:p%40ss@redis:6379' })),
    ).toEqual({ host: 'redis', port: 6379, password: 'p@ss' });
  });

  it('falls back to REDIS_PASSWORD when REDIS_URL carries none', () => {
    expect(
      buildRedisConnection(
        config({ REDIS_URL: 'redis://redis:6379', REDIS_PASSWORD: 's3cret' }),
      ),
    ).toEqual({ host: 'redis', port: 6379, password: 's3cret' });
  });

  it('keeps the URL password over REDIS_PASSWORD', () => {
    expect(
      buildRedisConnection(
        config({
          REDIS_URL: 'redis://:fromurl@redis:6379',
          REDIS_PASSWORD: 'other',
        }),
      ),
    ).toEqual({ host: 'redis', port: 6379, password: 'fromurl' });
  });

  it('authenticates the host/port fallback with REDIS_PASSWORD', () => {
    expect(
      buildRedisConnection(
        config({
          REDIS_URL: '',
          REDIS_HOST: 'redis',
          REDIS_PORT: '6380',
          REDIS_PASSWORD: 's3cret',
        }),
      ),
    ).toEqual({ host: 'redis', port: 6380, password: 's3cret' });
  });

  it('sends no password when none is configured', () => {
    expect(
      buildRedisConnection(config({ REDIS_URL: 'redis://redis:6379' })),
    ).toEqual({
      host: 'redis',
      port: 6379,
    });
    expect(
      buildRedisConnection(
        config({ REDIS_URL: 'rediss://redis:6379', REDIS_PASSWORD: '' }),
      ),
    ).toEqual({
      host: 'redis',
      port: 6379,
      tls: {},
    });
  });
});
