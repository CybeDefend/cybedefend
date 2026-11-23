import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileController } from './file.controller';
import { FileScan } from '../entities/file.entity';
import { FileService } from './file.service';
import { ConfigModule } from '@nestjs/config';
import { GrpcModule } from '@grpc/grpc.module';
import { FileCron } from './file.cron';
import { LoggerModule } from '../core/logger/logger.module';
import { SecretsModule } from '../core/secrets/secrets.module';

@Module({
  imports: [
    SecretsModule,
    LoggerModule,
    ConfigModule.forRoot(),
    TypeOrmModule.forFeature([FileScan]),
    GrpcModule.register(),
  ],
  controllers: [FileController],
  providers: [FileService, FileCron],
  exports: [FileService, FileCron],
})
export class FileModule {}
