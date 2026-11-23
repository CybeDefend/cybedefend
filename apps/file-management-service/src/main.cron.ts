import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { Logger as NestLogger } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { CronAppModule } from './cron.app.module';

async function bootstrap() {
  NestLogger.log('Starting file-management cron worker...');
  dotenv.config();
  const app = await NestFactory.createApplicationContext(CronAppModule, {
    bufferLogs: true,
  });
  // Nest's own logger writes to the console, which nothing collects: every
  // `new Logger()` of this context goes through pino from here on.
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('File-management cron worker started');
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
