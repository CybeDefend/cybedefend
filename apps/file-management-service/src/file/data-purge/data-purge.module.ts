import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileScan } from '../../entities/file.entity';
import { FileModule } from '../file.module';
import { FileService } from '../file.service';
import { DataPurgeController } from './data-purge.controller';
import { DataPurgeService } from './data-purge.service';
import { StoragePurge } from './storage-purge';

@Module({
  imports: [FileModule, TypeOrmModule.forFeature([FileScan])],
  controllers: [DataPurgeController],
  providers: [
    DataPurgeService,
    {
      provide: StoragePurge,
      // The bucket client is built by FileService (GCS in onModuleInit), so
      // it is read at call time, never at construction.
      useFactory: (files: FileService) =>
        new StoragePurge(() => files.storageTarget()),
      inject: [FileService],
    },
  ],
})
export class DataPurgeModule {}
