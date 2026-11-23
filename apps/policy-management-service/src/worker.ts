/**
 * Worker process entrypoint for BullMQ queue processing.
 *
 * This runs in a SEPARATE PROCESS from the main gRPC server.
 * It handles all queue processing for:
 * - Policy evaluation against scan results
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

async function bootstrap() {
  await tracer.start();
  dotenv.config();

  // Create a standalone NestJS application (no HTTP/gRPC server)
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}. Shutting down worker gracefully...`);
    await app.close();
    await tracer.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.log('🔧 BullMQ Worker started - processing policy evaluation queue');
  logger.log(
    `   Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
  );
  logger.log('   Queues: policy-evaluation-queue');

  // The application context will keep running and processing queue jobs
  // No need to call app.listen() - the BullMQ workers auto-start
}

bootstrap().catch((err) => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
