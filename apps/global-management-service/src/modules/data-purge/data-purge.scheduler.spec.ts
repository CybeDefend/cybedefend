import type { Logger } from 'nestjs-pino';
import type { DataPurgeRunner } from './data-purge.runner';
import { DATA_PURGE_TICK_MS, DataPurgeScheduler } from './data-purge.scheduler';

type Summary = Awaited<ReturnType<DataPurgeRunner['runDue']>>;

const SUMMARY: Summary = { jobs: 2, stepsDone: 5, stepsFailed: 1 };

/** A failure whose message quotes data: only its class may be logged. */
class LedgerReadError extends Error {}

function build(runDue: jest.Mock<Promise<Summary>, []>) {
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const scheduler = new DataPurgeScheduler(
    { runDue } as unknown as DataPurgeRunner,
    logger as unknown as Logger,
  );
  return { scheduler, logger };
}

/** Lets the promise chain of a tick settle under fake timers. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('DataPurgeScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('ticks with the period of the CronJob it replaces', () => {
    expect(DATA_PURGE_TICK_MS).toBe(10 * 60 * 1000);
  });

  it('runs the due purge jobs every 10 minutes', async () => {
    const runDue = jest.fn<Promise<Summary>, []>().mockResolvedValue(SUMMARY);
    const { scheduler, logger } = build(runDue);
    scheduler.onApplicationBootstrap();

    expect(runDue).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(DATA_PURGE_TICK_MS - 1);
    expect(runDue).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(runDue).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(DATA_PURGE_TICK_MS);
    expect(runDue).toHaveBeenCalledTimes(2);

    // The summary counts only.
    expect(logger.log).toHaveBeenCalledWith(
      'DATA_PURGE_TICK_DONE jobs=2 stepsDone=5 stepsFailed=1',
    );
    scheduler.onModuleDestroy();
  });

  it('does not keep the process alive', () => {
    const handle = { unref: jest.fn() };
    const spy = jest
      .spyOn(global, 'setInterval')
      .mockReturnValue(handle as unknown as ReturnType<typeof setInterval>);
    const clear = jest
      .spyOn(global, 'clearInterval')
      .mockImplementation(() => undefined);
    const runDue = jest.fn<Promise<Summary>, []>().mockResolvedValue(SUMMARY);
    const { scheduler } = build(runDue);
    scheduler.onApplicationBootstrap();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), DATA_PURGE_TICK_MS);
    expect(handle.unref).toHaveBeenCalledTimes(1);
    scheduler.onModuleDestroy();
    expect(clear).toHaveBeenCalledWith(handle);
    spy.mockRestore();
    clear.mockRestore();
  });

  it('stops on shutdown', async () => {
    const runDue = jest.fn<Promise<Summary>, []>().mockResolvedValue(SUMMARY);
    const { scheduler } = build(runDue);
    scheduler.onApplicationBootstrap();
    scheduler.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(DATA_PURGE_TICK_MS * 3);
    expect(runDue).not.toHaveBeenCalled();
  });

  it('starts one timer however often it is bootstrapped', async () => {
    const runDue = jest.fn<Promise<Summary>, []>().mockResolvedValue(SUMMARY);
    const { scheduler } = build(runDue);
    scheduler.onApplicationBootstrap();
    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(DATA_PURGE_TICK_MS);
    expect(runDue).toHaveBeenCalledTimes(1);
    scheduler.onModuleDestroy();
  });

  it('skips a tick while a run is in progress', async () => {
    let finish: (s: Summary) => void = () => undefined;
    const runDue = jest.fn<Promise<Summary>, []>().mockImplementationOnce(
      () =>
        new Promise<Summary>((resolve) => {
          finish = resolve;
        }),
    );
    runDue.mockResolvedValue(SUMMARY);
    const { scheduler, logger } = build(runDue);
    scheduler.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(DATA_PURGE_TICK_MS);
    expect(runDue).toHaveBeenCalledTimes(1);
    // The first run is still going: the next two ticks start nothing.
    await jest.advanceTimersByTimeAsync(DATA_PURGE_TICK_MS * 2);
    expect(runDue).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'DATA_PURGE_TICK_SKIPPED previous run still in progress',
    );

    finish(SUMMARY);
    await flush();
    await jest.advanceTimersByTimeAsync(DATA_PURGE_TICK_MS);
    expect(runDue).toHaveBeenCalledTimes(2);
    scheduler.onModuleDestroy();
  });

  it('survives a failed run', async () => {
    const runDue = jest
      .fn<Promise<Summary>, []>()
      .mockRejectedValueOnce(new LedgerReadError('org acme.example secret'))
      .mockResolvedValue(SUMMARY);
    const { scheduler, logger } = build(runDue);
    scheduler.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(DATA_PURGE_TICK_MS);
    expect(logger.error).toHaveBeenCalledWith(
      'DATA_PURGE_TICK_FAILED error=LedgerReadError',
    );
    // Only the class: never the message.
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('acme');

    await jest.advanceTimersByTimeAsync(DATA_PURGE_TICK_MS);
    expect(runDue).toHaveBeenCalledTimes(2);
    expect(logger.log).toHaveBeenCalledWith(
      'DATA_PURGE_TICK_DONE jobs=2 stepsDone=5 stepsFailed=1',
    );
    scheduler.onModuleDestroy();
  });
});
