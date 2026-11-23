import { Logger } from '@nestjs/common';

/** Minimal surface of a Nest application needed to shut down. */
export interface ClosableApp {
  close(): Promise<void>;
}

/** Minimal surface of the OpenTelemetry SDK wrapper used by each service. */
export interface ShutdownTracer {
  shutdown(): Promise<void>;
}

const logger = new Logger('GracefulShutdown');

/**
 * Wire a single graceful-shutdown path for the given OS signals.
 *
 * IMPORTANT: do NOT also call `app.enableShutdownHooks()`. That registers a
 * SECOND, independent SIGINT/SIGTERM listener which calls `app.close()` on its
 * own, so on shutdown both paths fire and the TypeORM datasource is destroyed
 * twice — surfacing as `Called end on pool more than once`. This helper is the
 * single owner of the shutdown sequence: `app.close()` already runs every Nest
 * lifecycle hook (including `beforeApplicationShutdown`) by itself, after which
 * we flush OpenTelemetry. A re-entrancy guard keeps the sequence to a single
 * run even if more than one of the signals is delivered.
 */
export function registerGracefulShutdown(
  app: ClosableApp,
  tracer: ShutdownTracer,
  signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'],
): void {
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      await app.close();
    } catch (err) {
      logger.error(
        'app.close() failed during shutdown',
        err instanceof Error ? err.stack : String(err),
      );
    }

    try {
      await tracer.shutdown();
    } catch (err) {
      logger.error(
        'tracer.shutdown() failed during shutdown',
        err instanceof Error ? err.stack : String(err),
      );
    }
    // Do not force process.exit(); let the orchestrator manage the lifecycle.
  };

  for (const signal of signals) {
    process.once(signal, () => void shutdown());
  }
}
