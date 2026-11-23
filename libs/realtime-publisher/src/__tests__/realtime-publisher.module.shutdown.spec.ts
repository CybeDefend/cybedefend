import { RealtimePublisherModule } from '../realtime-publisher.module';

/**
 * The publisher's Redis client comes from a factory provider, on which Nest
 * runs no lifecycle hook: left open, its socket kept every service that
 * imports this module alive after app.close(), so a SIGTERM never ended the
 * process.
 */
describe('RealtimePublisherModule shutdown', () => {
  const client = (quit: () => Promise<unknown>, status = 'ready') => ({
    status,
    quit: jest.fn(quit),
    disconnect: jest.fn(),
  });

  it('quits the publisher client at application shutdown', async () => {
    const c = client(() => Promise.resolve('OK'));
    await new RealtimePublisherModule(c as never).onApplicationShutdown();
    expect(c.quit).toHaveBeenCalledTimes(1);
    expect(c.disconnect).not.toHaveBeenCalled();
  });

  it('drops the socket when QUIT fails or hangs, within a bound', async () => {
    const failing = client(() => Promise.reject(new Error('closed')));
    await new RealtimePublisherModule(failing as never).onApplicationShutdown();
    expect(failing.disconnect).toHaveBeenCalledTimes(1);

    const hanging = client(() => new Promise(() => undefined));
    const started = Date.now();
    await new RealtimePublisherModule(hanging as never, 50).onApplicationShutdown();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(hanging.disconnect).toHaveBeenCalledTimes(1);
  });

  it('never throws, and leaves an ended client alone', async () => {
    await expect(
      new RealtimePublisherModule({} as never).onApplicationShutdown(),
    ).resolves.toBeUndefined();
    const ended = client(() => Promise.resolve('OK'), 'end');
    await new RealtimePublisherModule(ended as never).onApplicationShutdown();
    expect(ended.quit).not.toHaveBeenCalled();
  });
});
