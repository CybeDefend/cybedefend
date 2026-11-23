import { closeRedisClient, RedisToClose } from './close-redis-client';
import { GatewayRedisModule } from './gateway-redis.module';

function client(
  quit: () => Promise<unknown>,
  status = 'ready',
): RedisToClose & { disconnect: jest.Mock; quit: jest.Mock } {
  return { status, quit: jest.fn(quit), disconnect: jest.fn() };
}

describe('closeRedisClient', () => {
  it('quits the client, without forcing the socket', async () => {
    const c = client(() => Promise.resolve('OK'));
    await closeRedisClient(c, 1_000);
    expect(c.quit).toHaveBeenCalledTimes(1);
    expect(c.disconnect).not.toHaveBeenCalled();
  });

  it('drops the socket when QUIT fails (Redis gone)', async () => {
    const c = client(() => Promise.reject(new Error('Connection is closed.')));
    await closeRedisClient(c, 1_000);
    expect(c.disconnect).toHaveBeenCalledTimes(1);
  });

  it('drops the socket when QUIT does not answer within the bound', async () => {
    const c = client(() => new Promise(() => undefined));
    const started = Date.now();
    await closeRedisClient(c, 50);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(c.disconnect).toHaveBeenCalledTimes(1);
  });

  it('never throws, even on a double that has neither quit nor disconnect', async () => {
    await expect(closeRedisClient({} as never, 50)).resolves.toBeUndefined();
    await expect(
      closeRedisClient(
        {
          status: 'ready',
          quit: () => Promise.reject(new Error('x')),
          disconnect: () => {
            throw new Error('y');
          },
        },
        50,
      ),
    ).resolves.toBeUndefined();
  });

  it('does nothing to a client that already ended', async () => {
    const c = client(() => Promise.resolve('OK'), 'end');
    await closeRedisClient(c, 1_000);
    expect(c.quit).not.toHaveBeenCalled();
    expect(c.disconnect).not.toHaveBeenCalled();
  });
});

describe('GatewayRedisModule', () => {
  it('closes the shared REDIS_CLIENT at application shutdown, so a SIGTERM lets the process exit', async () => {
    const c = client(() => Promise.resolve('OK'));
    await new GatewayRedisModule(c as never).onApplicationShutdown();
    expect(c.quit).toHaveBeenCalledTimes(1);
  });
});
