/**
 * Worker process entrypoint for premium report generation.
 *
 * This runs in a SEPARATE PROCESS from the main gRPC server, the scan worker
 * and the autofix worker. It consumes:
 * - reports-queue             (per-project OWASP / CWE / EU AI Act / scanner-type)
 * - aggregated-reports-queue  (org / team / batch aggregated reports)
 *
 * Report generation is memory-heavy (full detection load + HTML render +
 * Puppeteer/Chromium PDF capture). Running it here means a giant report can
 * never OOM the scan-ingestion worker, and ingestion load can never starve
 * user-facing reports.
 *
 * Usage:
 *   pnpm run start:worker:reports       (production)
 *   pnpm run start:worker:reports:dev   (development with watch)
 */

import tracer from './tracer';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerReportsModule } from './worker-reports.module';
import * as dotenv from 'dotenv';
import { Logger } from 'nestjs-pino';
import { workerShutdown } from './worker.shutdown';

async function bootstrap() {
  await tracer.start();
  dotenv.config();

  // Standalone application context (no HTTP/gRPC server): queue-depth
  // metrics for KEDA are served by the main worker, which registers all
  // queues — same pattern as the autofix worker.
  const app = await NestFactory.createApplicationContext(WorkerReportsModule, {
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);
  // Dropped spans and failed exports, dated in the OTLP backend rather than on stdout.
  tracer.routeDiagnostics(logger);

  // Graceful shutdown handling — closes BullMQ workers, draining in-flight
  // renders before exit.
  // Then the spans still queued in the batch processor, before the exit.
  const shutdown = workerShutdown(app, tracer, logger, 'reports worker');

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.log('BullMQ Reports Worker started - processing report queues');
  logger.log(
    `   Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
  );
  logger.log('   Queues: reports-queue, aggregated-reports-queue');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console -- the bootstrap failed before a logger existed
  console.error('Failed to start reports worker:', err);
  process.exit(1);
});
