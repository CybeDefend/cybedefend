/**
 * Worker process entrypoint for BullMQ queue processing.
 *
 * This runs in a SEPARATE PROCESS from the main gRPC server.
 * It handles all queue processing for:
 * - SCA scan results
 * - SAST/IAC scan results
 * - Container scan results
 *
 * It also serves a lightweight HTTP endpoint for KEDA autoscaling:
 * - GET /internal/queue-metrics  (port METRICS_PORT, default 9095)
 *
 * Usage:
 *   pnpm run start:worker       (production)
 *   pnpm run start:worker:dev   (development with watch)
 *
 * This architecture ensures that heavy queue processing doesn't block
 * the main gRPC server's event loop, keeping the API responsive.
 */

import tracer from './tracer';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import * as dotenv from 'dotenv';
import { Logger } from 'nestjs-pino';
import { workerShutdown } from './worker.shutdown';

async function bootstrap() {
  await tracer.start();
  dotenv.config();

  // Create a full HTTP NestJS application so the worker can also serve
  // the /internal/queue-metrics endpoint used by KEDA for autoscaling.
  // BullMQ processors are providers — they auto-start on module init
  // regardless of whether the app is a context or an HTTP server.
  const app = await NestFactory.create(WorkerModule, { bufferLogs: true });

  const logger = app.get(Logger);
  app.useLogger(logger);
  // Dropped spans and failed exports, dated in the OTLP backend rather than on stdout.
  tracer.routeDiagnostics(logger);

  // Graceful shutdown handling — closes BullMQ workers (draining in-flight
  // jobs) and the HTTP server in a single app.close() call.
  // Then the spans still queued in the batch processor, before the exit.
  const shutdown = workerShutdown(app, tracer, logger, 'worker');

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const metricsPort = Number(process.env.METRICS_PORT) || 9095;
  await app.listen(metricsPort, '0.0.0.0');

  logger.log('BullMQ Worker started - processing scan result queues');
  logger.log(
    `   Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
  );
  logger.log(
    '   Queues: sca-scan-queue, sast-iac-scan-queue, container-scan-queue',
  );
  logger.log(
    `   Metrics HTTP endpoint: http://0.0.0.0:${metricsPort}/internal/queue-metrics`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console -- the bootstrap failed before a logger existed
  console.error('Failed to start worker:', err);
  process.exit(1);
});
