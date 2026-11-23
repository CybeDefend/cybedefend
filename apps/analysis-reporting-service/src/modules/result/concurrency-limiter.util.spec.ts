import { createConcurrencyLimiter } from './concurrency-limiter.util';

/** A task the test resolves or rejects by hand. */
const deferred = <T>() => {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((r) => setImmediate(r));

describe('createConcurrencyLimiter', () => {
  it('never runs more than the limit at once, and starts the next one as soon as one ends', async () => {
    const run = createConcurrencyLimiter(2);
    const gates = Array.from({ length: 5 }, () => deferred<number>());
    let inFlight = 0;
    let peak = 0;
    const started: number[] = [];

    const all = Promise.all(
      gates.map((gate, i) =>
        run(async () => {
          started.push(i);
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          try {
            return await gate.promise;
          } finally {
            inFlight -= 1;
          }
        }),
      ),
    );

    await flush();
    expect(started).toEqual([0, 1]);

    gates[1].resolve(1);
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates.forEach((gate, i) => gate.resolve(i));
    await expect(all).resolves.toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  it('passes a rejection to its caller and keeps serving the queue', async () => {
    const run = createConcurrencyLimiter(1);

    const failing = run(() => Promise.reject(new Error('boom')));
    const next = run(() => Promise.resolve('next'));

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('next');
  });

  it('treats a task that throws synchronously as a rejection', async () => {
    const run = createConcurrencyLimiter(1);

    await expect(
      run(() => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    await expect(run(() => Promise.resolve(1))).resolves.toBe(1);
  });

  it('refuses a limit below 1', () => {
    expect(() => createConcurrencyLimiter(0)).toThrow();
  });
});
