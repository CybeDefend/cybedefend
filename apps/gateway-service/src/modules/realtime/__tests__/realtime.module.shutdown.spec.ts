import { RealtimeModule } from '../realtime.module';
import { MembershipRegistry } from '../membership.registry';

describe('RealtimeModule shutdown', () => {
  it('closes the realtime subscriber at application shutdown, so a SIGTERM lets the process exit', async () => {
    const sub = {
      status: 'ready',
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    };
    const mod = new RealtimeModule(
      sub as never,
      {} as unknown as MembershipRegistry,
    );
    await mod.onApplicationShutdown();
    expect(sub.quit).toHaveBeenCalledTimes(1);
  });
});
