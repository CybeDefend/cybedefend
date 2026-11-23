import type { Worker as NodeWorker, WorkerOptions } from 'node:worker_threads';
import {
  ZIP_WORKER_RESOURCE_LIMITS,
  defaultZipWorkerFactory,
  runZipProcessingInWorker,
} from './zip-processor';

/**
 * The zip worker's memory isolation.
 *
 * The repo-scan worker was evicted with exit 137 — a cgroup SIGKILL of the
 * whole pod — because the zip rewrite had no heap ceiling of its own. With
 * `resourceLimits` a runaway rewrite hits `ERR_WORKER_OUT_OF_MEMORY` and takes
 * down only its own thread, so the job fails and every other in-flight job (and
 * the gRPC server) survives.
 */

// Keep the real module available: one test drives an actual worker thread.
const actualWorkerThreads = jest.requireActual<
  typeof import('node:worker_threads')
>('node:worker_threads');

jest.mock('node:worker_threads', () => {
  const actual = jest.requireActual<typeof import('node:worker_threads')>(
    'node:worker_threads',
  );
  return {
    ...actual,
    // A stub constructor: this suite asserts on the options it is handed, it
    // never needs the thread to start.
    Worker: jest.fn((filename: string, options: WorkerOptions) => ({
      filename,
      options,
      once: jest.fn(),
      terminate: jest.fn(),
    })),
  };
});

jest.setTimeout(60_000);

describe('zip-processor worker resource limits', () => {
  it('declares a bounded heap for the zip worker', () => {
    expect(ZIP_WORKER_RESOURCE_LIMITS).toEqual({
      maxOldGenerationSizeMb: 1024,
      maxYoungGenerationSizeMb: 128,
    });
  });

  it('passes the resource limits to the Worker it spawns', () => {
    const { Worker } = jest.requireMock<typeof import('node:worker_threads')>(
      'node:worker_threads',
    );
    (Worker as unknown as jest.Mock).mockClear();

    defaultZipWorkerFactory({
      inputPath: 'in.zip',
      outputPath: 'out.zip',
      gitDir: '/tmp/git',
    });

    expect(Worker).toHaveBeenCalledTimes(1);
    const [entry, options] = (Worker as unknown as jest.Mock).mock.calls[0] as [
      string,
      WorkerOptions,
    ];
    expect(entry).toMatch(/zip-processor\.worker\.js$/);
    expect(options.workerData).toEqual({
      inputPath: 'in.zip',
      outputPath: 'out.zip',
      gitDir: '/tmp/git',
    });
    expect(options.resourceLimits).toEqual({
      maxOldGenerationSizeMb: 1024,
      maxYoungGenerationSizeMb: 128,
    });
  });
});

describe('zip-processor worker OOM isolation', () => {
  /** A real worker thread whose heap ceiling is far too small for its task. */
  function spawnStarvedWorker(): NodeWorker {
    return new actualWorkerThreads.Worker(
      'const held = []; for (;;) { held.push(new Array(200000).fill("x")); }',
      {
        eval: true,
        resourceLimits: {
          maxOldGenerationSizeMb: 32,
          maxYoungGenerationSizeMb: 8,
        },
      },
    );
  }

  it('surfaces a heap-limit death as a clear error and leaves the process alive', async () => {
    const promise = runZipProcessingInWorker(
      'in.zip',
      'out.zip',
      undefined,
      () =>
        spawnStarvedWorker() as unknown as ReturnType<
          typeof defaultZipWorkerFactory
        >,
    );

    await expect(promise).rejects.toThrow(
      'ZIP worker ran out of memory (heap limit reached) while rewriting the archive',
    );

    // The pod survived: this process can still spawn and complete work.
    expect(process.exitCode).toBeUndefined();
    const survivor = new actualWorkerThreads.Worker(
      'require("node:worker_threads").parentPort.postMessage("alive");',
      { eval: true },
    );
    await expect(
      new Promise((resolve, reject) => {
        survivor.once('message', resolve);
        survivor.once('error', reject);
      }),
    ).resolves.toBe('alive');
    await survivor.terminate();
  });

  it('still reports a non-OOM worker error verbatim', async () => {
    const boom = new actualWorkerThreads.Worker(
      'throw new Error("archive is corrupt");',
      { eval: true },
    );

    await expect(
      runZipProcessingInWorker(
        'in.zip',
        'out.zip',
        undefined,
        () => boom as unknown as ReturnType<typeof defaultZipWorkerFactory>,
      ),
    ).rejects.toThrow('archive is corrupt');
  });
});
