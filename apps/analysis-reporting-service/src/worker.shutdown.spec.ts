import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workerShutdown } from './worker.shutdown';

/**
 * 75 to 96 % of the worker's root spans never reached
 * the OTLP backend. One leak was the exit path: `process.exit(0)` right after
 * `app.close()` killed the batch processor with its queue (up to five seconds
 * of spans, a scan's finalisation among them), every time KEDA scaled a
 * worker down.
 */
describe('workerShutdown', () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };

  it('drains, then flushes the spans, then exits', async () => {
    const calls: string[] = [];
    const flush = deferred();
    const shutdown = workerShutdown(
      { close: async () => void calls.push('app.close') },
      {
        shutdown: async () => {
          calls.push('tracer.shutdown');
          await flush.promise;
          calls.push('tracer.flushed');
        },
      },
      { log: (message) => void calls.push(message) },
      'reports worker',
      (code) => void calls.push(`exit ${code}`),
    );

    const done = shutdown('SIGTERM');
    await new Promise((r) => setImmediate(r));
    // Still flushing: the process must not be gone yet.
    expect(calls).toEqual([
      'Received SIGTERM. Shutting down reports worker gracefully...',
      'app.close',
      'tracer.shutdown',
    ]);

    flush.resolve();
    await done;
    expect(calls.slice(3)).toEqual(['tracer.flushed', 'exit 0']);
  });

  it('flushes the spans even when the drain fails, and lets the error surface', async () => {
    const calls: string[] = [];
    const shutdown = workerShutdown(
      {
        close: async () => {
          throw new Error('redis gone');
        },
      },
      { shutdown: async () => void calls.push('tracer.shutdown') },
      { log: () => undefined },
      'worker',
      (code) => void calls.push(`exit ${code}`),
    );

    await expect(shutdown('SIGINT')).rejects.toThrow('redis gone');
    // As before: no exit(0) after a failed close (the rejection ends the process).
    expect(calls).toEqual(['tracer.shutdown']);
  });

  // worker-autofix.ts is closed (its case is in a closed spec).
  it.each(['worker.ts', 'worker-reports.ts'])(
    '%s exits through it and sends SDK warnings to its logger',
    (entrypoint) => {
      const source = readFileSync(join(__dirname, entrypoint), 'utf-8');
      expect(source).toContain('workerShutdown(');
      expect(source).toContain('tracer.routeDiagnostics(logger)');
      expect(source).not.toMatch(/await app\.close\(\);\s*process\.exit/);
    },
  );
});

describe('main.ts (gRPC server)', () => {
  it('sends SDK warnings to its logger, as the workers do', () => {
    const source = readFileSync(join(__dirname, 'main.ts'), 'utf-8');
    expect(source).toContain('tracer.routeDiagnostics(app.get(Logger))');
  });
});
