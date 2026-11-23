import { registerGracefulShutdown } from './graceful-shutdown';

describe('registerGracefulShutdown', () => {
  let onceSpy: jest.SpyInstance;

  beforeEach(() => {
    // Record the signal registrations WITHOUT attaching real OS listeners,
    // so emitting them in tests cannot interfere with the Jest process.
    onceSpy = jest
      .spyOn(process, 'once')
      .mockImplementation(() => process as NodeJS.Process);
    jest
      .spyOn(process, 'on')
      .mockImplementation(() => process as NodeJS.Process);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  const handlerFor = (signal: NodeJS.Signals): (() => void) | undefined =>
    onceSpy.mock.calls.find(([sig]) => sig === signal)?.[1] as
      | (() => void)
      | undefined;

  const makeApp = (close = jest.fn().mockResolvedValue(undefined)) => ({
    close,
  });
  const makeTracer = (shutdown = jest.fn().mockResolvedValue(undefined)) => ({
    shutdown,
  });

  it('registers a one-shot handler for SIGINT and SIGTERM by default', () => {
    registerGracefulShutdown(makeApp(), makeTracer());

    const signals = onceSpy.mock.calls.map(([sig]) => sig);
    expect(signals).toEqual(expect.arrayContaining(['SIGINT', 'SIGTERM']));
  });

  it('closes the app then flushes the tracer when a signal fires', async () => {
    const app = makeApp();
    const tracer = makeTracer();
    registerGracefulShutdown(app, tracer);

    handlerFor('SIGTERM')!();
    await tick();

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(tracer.shutdown).toHaveBeenCalledTimes(1);
  });

  it('runs the shutdown sequence only once when several signals fire', async () => {
    const app = makeApp();
    const tracer = makeTracer();
    registerGracefulShutdown(app, tracer);

    // Both SIGTERM and SIGINT delivered — the re-entrancy guard must keep
    // app.close() to a single call (this is the bug being fixed: two paths
    // calling close → "Called end on pool more than once").
    handlerFor('SIGTERM')!();
    handlerFor('SIGINT')!();
    await tick();

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(tracer.shutdown).toHaveBeenCalledTimes(1);
  });

  it('still flushes the tracer when app.close() rejects', async () => {
    const app = makeApp(jest.fn().mockRejectedValue(new Error('boom')));
    const tracer = makeTracer();
    registerGracefulShutdown(app, tracer);

    handlerFor('SIGTERM')!();
    await tick();

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(tracer.shutdown).toHaveBeenCalledTimes(1);
  });
});
