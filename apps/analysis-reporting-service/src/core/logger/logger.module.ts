import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { createHttpLoggerOptions, createLoggerOptions } from './logger';
import { Module, RequestMethod } from '@nestjs/common';
import { fetchOtelIngestToken } from './otel-token-fetcher';
import Pino from 'pino';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      useFactory: async () => {
        // The OTLP ingest token, read before the logger is built
        const otelToken = await fetchOtelIngestToken();
        const loggerInstance = Pino(
          createLoggerOptions({ otelIngestToken: otelToken }),
        );
        return {
          pinoHttp: createHttpLoggerOptions(loggerInstance),
          exclude: [{ method: RequestMethod.ALL, path: 'health' }],
        };
      },
    }),
  ],
  controllers: [],
  providers: [],
})
export class LoggerModule {}
