import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { FileScan, FileStatus } from '../entities/file.entity';
import { Repository } from 'typeorm';

import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import { FileService } from './file.service';
import { ArchiveLimitError, ARCHIVE_FAILURE_CATEGORY } from './zip-limits.util';

@Injectable()
export class FileCron implements OnModuleInit {
  scanServiceClient: ScanServiceClient;
  uploadTimeoutMinutes: number;
  processingFiles: Map<string, boolean> = new Map();
  processingTimeoutMinutes: number;
  // Uploads processed at once by this pod: ticks overlap, and each processing
  // holds its archive's buffers (FILE_SCAN_PROCESSING_CONCURRENCY, default 1).
  processingConcurrency: number;

  constructor(
    @InjectRepository(FileScan)
    private readonly fileScanRepository: Repository<FileScan>,
    private readonly logger: Logger,
    private readonly configService: ConfigService,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly scanningClient: ClientGrpc,
    private readonly fileService: FileService,
  ) {
    // Initialise the timeouts
    this.uploadTimeoutMinutes = this.configService.get<number>(
      'FILE_SCAN_UPLOAD_TIMEOUT_MINUTES',
      30,
    );
    this.processingTimeoutMinutes = this.configService.get<number>(
      'FILE_SCAN_PROCESSING_TIMEOUT_MINUTES',
      15,
    );
    this.processingConcurrency = Math.max(
      1,
      Math.floor(
        Number(this.configService.get('FILE_SCAN_PROCESSING_CONCURRENCY', 1)) ||
          1,
      ),
    );
  }

  /**
   * On module init:
   * - Initialize gRPC scanning client
   */
  async onModuleInit(): Promise<void> {
    this.scanServiceClient =
      this.scanningClient.getService<ScanServiceClient>(SCAN_SERVICE_NAME);
  }

  /**
   * Scheduled task (every 5 seconds) to:
   * - handle upload timeouts
   * - process ready uploads
   * - handle processing timeouts and delete timed-out files
   */
  @Cron('*/5 * * * * *')
  async checkPendingUploads() {
    const now = Date.now();
    try {
      const pendingUploads = await this.fileScanRepository.find({
        where: { status: FileStatus.PENDING_UPLOAD },
      });
      const uploadTimeoutCutoff = now - this.uploadTimeoutMinutes * 60 * 1000;

      // A ready upload is processed when one of the processingConcurrency
      // slots is free, else it waits for a later tick. Only an upload whose
      // archive never arrived is failed as timed out: a ready one waiting for
      // a slot is not.
      const admitted: FileScan[] = [];
      for (const record of pendingUploads) {
        if (this.processingFiles.get(record.scanId)) continue;
        let ready: boolean;
        try {
          ready = await this.fileService.isFileReady(record.objectPath);
        } catch (err) {
          this.logger.error(`Could not check upload ${record.scanId}`, err);
          continue;
        }
        if (!ready) {
          if (record.createdAt.getTime() < uploadTimeoutCutoff) {
            await this.failTimedOutUpload(record, now, uploadTimeoutCutoff);
          }
          continue;
        }
        if (this.processingFiles.size >= this.processingConcurrency) continue;
        // Taken before the next await, so an overlapping tick sees it.
        this.processingFiles.set(record.scanId, true);
        const fresh = await this.fileScanRepository.findOne({
          where: { scanId: record.scanId },
        });
        if (!fresh || fresh.status !== FileStatus.PENDING_UPLOAD) {
          this.processingFiles.delete(record.scanId);
          continue;
        }
        admitted.push(record);
      }
      await Promise.allSettled(
        admitted.map((record) => this.processUpload(record)),
      );

      // handle processing timeouts
      const processingRecords = await this.fileScanRepository.find({
        where: { status: FileStatus.PROCESSING },
      });
      const processingTimeoutCutoff =
        now - this.processingTimeoutMinutes * 60 * 1000;
      for (const record of processingRecords) {
        if (record.updatedAt.getTime() < processingTimeoutCutoff) {
          this.logger.warn(`Processing timed out for ${record.scanId}`);

          // mark as failed
          await this.fileScanRepository.update(
            { id: record.id },
            { status: FileStatus.FAILED, updatedAt: new Date() },
          );

          // notify scan service
          try {
            await safeGrpcCall(
              this.scanServiceClient.updateScanData({
                scanId: record.scanId,
                state: 'failed',
                errorMessage: 'Processing exceeded timeout threshold',
              }),
            );
          } catch (notifyErr) {
            this.logger.error(
              `Failed to notify scan service of timeout for ${record.scanId}`,
              notifyErr,
            );
          }

          // delete the file from storage
          const objectPath = record.objectPath;
          try {
            await this.fileService.deleteFileFromStorage(objectPath, true);
            this.logger.log(
              `Deleted file ${objectPath} after processing timeout`,
            );
          } catch (delErr) {
            this.logger.error(
              `Failed to delete object ${objectPath} after timeout`,
              delErr,
            );
          }

          // ensure no retry
          this.processingFiles.delete(record.scanId);
        }
      }
    } catch (err) {
      this.logger.error('Error in checkPendingUploads', err);
    }
  }

  /**
   * Scheduled cleanup task (once per hour) to remove old orphaned records.
   *
   * - FAILED records older than 24 hours: terminal state, safe to drop.
   * - PENDING_UPLOAD records older than 24 hours: client never finished
   *   the upload, drop them.
   * - PROCESSING records older than 1 hour: defence in depth — if the
   *   worker crashes mid-processing (for instance on a stream error), the
   *   row is left stuck in PROCESSING and the per-tick processing-timeout
   *   path in `checkPendingUploads` ignores it once the cutoff passes the
   *   normal `processingTimeoutMinutes`. The 1-hour cutoff here is well
   *   above any legitimate processing duration (the configured default
   *   `FILE_SCAN_PROCESSING_TIMEOUT_MINUTES` is 15 min).
   *
   * Reports are not swept here: they are persisted with a DB-tracked
   * `expiresAt` and purged by the retention cron in analysis-reporting
   * (object first, then DB row), so an age-based sweep here would delete
   * reports still within their retention window.
   */
  /** Fail the scan of an upload whose archive never arrived, and drop it. */
  private async failTimedOutUpload(
    record: FileScan,
    now: number,
    uploadTimeoutCutoff: number,
  ): Promise<void> {
    this.logger.warn(
      `Upload timed out for ${record.scanId} - ${now} exceeded ${uploadTimeoutCutoff}`,
    );

    // Try to update scan data, but don't fail if scan doesn't exist. Nothing
    // was ever processed: the scan says the archive never arrived, with its
    // code and the deadline, and ends now.
    const notReceived = new ArchiveLimitError(
      'ARCHIVE_NOT_RECEIVED',
      `No archive was uploaded within ${this.uploadTimeoutMinutes} minutes of the scan's start`,
    );
    try {
      await safeGrpcCall(
        this.scanServiceClient.updateScanData({
          scanId: record.scanId,
          state: 'failed',
          errorMessage: notReceived.scanErrorMessage,
          errorCode: notReceived.errorCode,
          errorCategory: ARCHIVE_FAILURE_CATEGORY,
          endTime: new Date(now).toISOString(),
        }),
      );
    } catch (updateErr) {
      this.logger.warn(
        `Could not update scan ${record.scanId} (may have been deleted) - marking file record as failed anyway`,
        updateErr,
      );
    }

    // Always update the file record status
    await this.fileScanRepository.update(
      { id: record.id },
      { status: FileStatus.FAILED, updatedAt: new Date() },
    );

    // Try to delete the file from storage
    try {
      await this.fileService.deleteFileFromStorage(record.objectPath, true);
      this.logger.log(`Deleted file ${record.objectPath} after upload timeout`);
    } catch (delErr) {
      this.logger.error(
        `Failed to delete object ${record.objectPath} after timeout`,
        delErr,
      );
    }
  }

  /** Process one admitted upload; its slot is released whatever happens. */
  private async processUpload(record: FileScan): Promise<void> {
    this.logger.log(`Processing upload ${record.scanId}`);
    try {
      await this.fileScanRepository.update(
        { id: record.id },
        { status: FileStatus.PROCESSING, updatedAt: new Date() },
      );
      await this.fileService.processUploadedFile(record);
    } catch (e) {
      this.logger.error(`Background processing error for ${record.scanId}`, e);
    } finally {
      this.processingFiles.delete(record.scanId);
    }
    this.logger.log(`Finished processing upload ${record.scanId}`);
  }

  @Cron('0 0 * * * *') // Every hour at :00
  async cleanupOrphanedRecords() {
    try {
      const now = Date.now();
      const longCutoff = now - 24 * 60 * 60 * 1000; // 24 hours
      const processingCutoff = now - 60 * 60 * 1000; // 1 hour

      // Find old FAILED, PENDING_UPLOAD (24h) and PROCESSING (1h) records
      const orphanedRecords = await this.fileScanRepository
        .createQueryBuilder('file_scan')
        .where(
          '(file_scan.status IN (:...longStatuses) AND file_scan.updatedAt < :longThreshold) OR (file_scan.status = :processingStatus AND file_scan.updatedAt < :processingThreshold)',
          {
            longStatuses: [FileStatus.FAILED, FileStatus.PENDING_UPLOAD],
            longThreshold: new Date(longCutoff),
            processingStatus: FileStatus.PROCESSING,
            processingThreshold: new Date(processingCutoff),
          },
        )
        .getMany();

      if (orphanedRecords.length === 0) {
        this.logger.log('No orphaned records to clean up');
        return;
      }

      this.logger.log(
        `Found ${orphanedRecords.length} orphaned records to clean up`,
      );

      for (const record of orphanedRecords) {
        try {
          // Try to delete file from storage if objectPath exists
          if (record.objectPath) {
            try {
              await this.fileService.deleteFileFromStorage(
                record.objectPath,
                true,
              );
              this.logger.log(
                `Deleted orphaned file ${record.objectPath} for scan ${record.scanId} (status=${record.status})`,
              );
            } catch {
              this.logger.warn(
                `Failed to delete orphaned file ${record.objectPath} (may already be deleted)`,
              );
            }
          }

          // For stuck PROCESSING rows, mark FAILED first so any external
          // observer sees the terminal state before the row disappears.
          if (record.status === FileStatus.PROCESSING) {
            try {
              await this.fileScanRepository.update(
                { id: record.id },
                { status: FileStatus.FAILED, updatedAt: new Date() },
              );
            } catch (markErr) {
              this.logger.warn(
                `Failed to mark stuck PROCESSING row ${record.id} as FAILED before deletion`,
                markErr,
              );
            }
          }

          // Delete the database record
          await this.fileScanRepository.delete({ id: record.id });
          this.logger.log(
            `Deleted orphaned FileScan record for scan ${record.scanId}`,
          );
        } catch (err) {
          this.logger.error(
            `Error cleaning up orphaned record ${record.id}`,
            err,
          );
        }
      }

      this.logger.log(
        `Cleanup completed: ${orphanedRecords.length} orphaned records processed`,
      );
    } catch (err) {
      this.logger.error('Error in cleanupOrphanedRecords', err);
    }
  }
}
