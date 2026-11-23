import { Module } from '@nestjs/common';
import { GrpcModule } from 'src/core/grpc/grpc.module';
import { ReportUploadService } from './report-upload.service';

/**
 * Shared module that exposes ReportUploadService to every report-generation
 * module (scanner-type, OWASP, CWE, aggregated). Centralises the
 * file-management gRPC client dependency so each report module just imports
 * ReportUploadModule.
 */
@Module({
  imports: [GrpcModule.register()],
  providers: [ReportUploadService],
  exports: [ReportUploadService],
})
export class ReportUploadModule {}
