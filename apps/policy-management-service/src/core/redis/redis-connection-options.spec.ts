import { ConfigService } from '@nestjs/config';
import { redisConnectionOptions } from './redis-connection-options';

const config = (env: Record<string, string | number | undefined>) =>
  new ConfigService(env);

describe('redisConnectionOptions', () => {
  it('connects by host and port, without a password when none is set', () => {
    expect(
      redisConnectionOptions(config({ REDIS_HOST: 'redis', REDIS_PORT: 6380 })),
    ).toEqual({ host: 'redis', port: 6380 });
  });

  it('defaults to localhost:6379', () => {
    expect(redisConnectionOptions(config({}))).toEqual({
      host: 'localhost',
      port: 6379,
    });
  });

  it('authenticates with REDIS_PASSWORD when it is set', () => {
    expect(
      redisConnectionOptions(
        config({
          REDIS_HOST: 'redis',
          REDIS_PORT: '6379',
          REDIS_PASSWORD: 's3cret',
        }),
      ),
    ).toEqual({ host: 'redis', port: 6379, password: 's3cret' });
  });

  it('sends no password for an empty REDIS_PASSWORD', () => {
    expect(
      redisConnectionOptions(
        config({ REDIS_HOST: 'redis', REDIS_PASSWORD: '' }),
      ),
    ).toEqual({ host: 'redis', port: 6379 });
  });
});
