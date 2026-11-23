/** What a worker entrypoint needs to stop: its Nest app, its tracer, a logger. */
export interface ClosableApp {
  close(): Promise<void>;
}

export interface ShutdownTracer {
  shutdown(): Promise<void>;
}

export interface ShutdownLogger {
  log(message: string): void;
}

/**
 * SIGTERM / SIGINT handler of a BullMQ worker process: drain the queues
 * (`app.close()`), flush the spans still in the batch processor, then exit.
 *
 * The flush is what this adds. `process.exit(0)` used to follow `app.close()`
 * directly and took the batch processor's queue with it, every time KEDA
 * scaled a worker down. `tracer.shutdown()` never throws.
 * When `app.close()` throws, the spans are flushed and the error propagates,
 * as it did before: no `exit(0)` after a failed drain.
 */
export function workerShutdown(
  app: ClosableApp,
  tracer: ShutdownTracer,
  logger: ShutdownLogger,
  label: string,
  exit: (code: number) => void = (code) => process.exit(code),
): (signal: string) => Promise<void> {
  return async (signal: string) => {
    logger.log(`Received ${signal}. Shutting down ${label} gracefully...`);
    try {
      await app.close();
    } finally {
      await tracer.shutdown();
    }
    exit(0);
  };
}
