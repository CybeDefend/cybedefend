import { Module } from '@nestjs/common';
import { ResultsImportController } from './results-import.controller';

/**
 * The SARIF import's gRPC entry, in the API context: ImportResults
 * queues the job. The job itself runs in the worker (ResultsImportProcessor,
 * worker.module.ts). ScanQueueService comes from the global ScanQueueModule.
 */
@Module({
  controllers: [ResultsImportController],
})
export class ResultsImportModule {}
