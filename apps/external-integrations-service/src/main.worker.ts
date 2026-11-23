/**
 * Worker process entrypoint for external-integrations BullMQ queue processing.
 *
 * Runs in a SEPARATE process from the main gRPC server. Consumes the repo-scan
 * queue (download → zip → upload → startScan) and serves a lightweight HTTP
 * endpoint for KEDA autoscaling:
 *   - GET /internal/queue-metrics  (port METRICS_PORT, default 9095)
 *
 * Usage:
 *   pnpm run start:worker       (production — node dist/main.worker)
 *   pnpm run start:worker:dev   (development)
 */
import tracer from './tracer';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  await tracer.start();
  dotenv.config();

  // Full HTTP app so the worker can also serve /internal/queue-metrics for KEDA.
  // BullMQ processors are providers — they auto-start on module init.
  const app = await NestFactory.create(WorkerModule, { bufferLogs: true });

  const logger = app.get(Logger);
  app.useLogger(logger);

  // Graceful shutdown — app.close() drains in-flight BullMQ jobs and closes the
  // HTTP server before exit.
  const shutdown = async (signal: string) => {
    logger.log(
      `Received ${signal}. Shutting down repo-scan worker gracefully...`,
    );
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const metricsPort = Number(process.env.METRICS_PORT) || 9095;
  await app.listen(metricsPort, '0.0.0.0');

  logger.log('Repo-scan BullMQ worker started');
  logger.log(`   Queue: repo-scan-queue`);
  logger.log(
    `   Metrics HTTP endpoint: http://0.0.0.0:${metricsPort}/internal/queue-metrics`,
  );
}

bootstrap().catch((err) => {
  console.error('Failed to start repo-scan worker:', err);
  process.exit(1);
});
