import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';

import { FileCron } from './file.cron';
import { FileService } from './file.service';
import { FileScan, FileStatus } from 'src/entities/file.entity';
import { createLoggerMock } from 'src/test-utils/mocks';

describe('FileCron.cleanupOrphanedRecords', () => {
  let cron: FileCron;
  let getMany: jest.Mock;
  let where: jest.Mock;
  let andWhere: jest.Mock;
  let createQueryBuilder: jest.Mock;
  let repoUpdate: jest.Mock;
  let repoDelete: jest.Mock;
  let deleteFileFromStorage: jest.Mock;

  const buildModule = async () => {
    getMany = jest.fn().mockResolvedValue([]);
    where = jest.fn().mockReturnValue({ andWhere: andWhere, getMany });
    andWhere = jest.fn().mockReturnValue({ getMany });
    where = jest.fn().mockReturnValue({ andWhere, getMany });
    createQueryBuilder = jest.fn().mockReturnValue({ where, getMany });
    repoUpdate = jest.fn().mockResolvedValue(undefined);
    repoDelete = jest.fn().mockResolvedValue(undefined);
    deleteFileFromStorage = jest.fn().mockResolvedValue(undefined);

    const fileScanRepo = {
      createQueryBuilder,
      update: repoUpdate,
      delete: repoDelete,
      find: jest.fn().mockResolvedValue([]),
    };

    const mockScanClient = {
      getService: jest.fn().mockReturnValue({
        startScan: jest.fn(),
        updateScanData: jest.fn(),
      }),
    } as unknown as ClientGrpc;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileCron,
        { provide: getRepositoryToken(FileScan), useValue: fileScanRepo },
        { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            FILE_SCAN_UPLOAD_TIMEOUT_MINUTES: 30,
            FILE_SCAN_PROCESSING_TIMEOUT_MINUTES: 15,
          }),
        },
        {
          provide: FileService,
          useValue: { deleteFileFromStorage },
        },
        { provide: Logger, useValue: createLoggerMock() },
      ],
    }).compile();

    cron = module.get(FileCron);
  };

  beforeEach(async () => {
    await buildModule();
  });

  it('queries with both long-cutoff (FAILED, PENDING_UPLOAD) AND processing-cutoff (PROCESSING)', async () => {
    await cron.cleanupOrphanedRecords();

    expect(createQueryBuilder).toHaveBeenCalled();
    // The single combined where(...) call should reference both buckets.
    expect(where).toHaveBeenCalledTimes(1);
    const [sql, params] = where.mock.calls[0];
    expect(sql).toMatch(/longStatuses/);
    expect(sql).toMatch(/processingStatus/);
    expect(sql).toMatch(/processingThreshold/);
    expect(params.longStatuses).toEqual(
      expect.arrayContaining([FileStatus.FAILED, FileStatus.PENDING_UPLOAD]),
    );
    expect(params.processingStatus).toBe(FileStatus.PROCESSING);
    // Processing threshold must be more recent than long threshold
    expect(params.processingThreshold.getTime()).toBeGreaterThan(
      params.longThreshold.getTime(),
    );
    // Processing threshold should be ~1 hour ago (>50 min, <90 min)
    const ageMs = Date.now() - params.processingThreshold.getTime();
    expect(ageMs).toBeGreaterThan(50 * 60 * 1000);
    expect(ageMs).toBeLessThan(90 * 60 * 1000);
  });

  it('marks stuck PROCESSING rows as FAILED before deleting them', async () => {
    const stuck: any = {
      id: 'row-1',
      scanId: 'scan-stuck',
      status: FileStatus.PROCESSING,
      objectPath: 'scan/p/scan-stuck.zip',
    };
    getMany.mockResolvedValueOnce([stuck]);

    await cron.cleanupOrphanedRecords();

    expect(deleteFileFromStorage).toHaveBeenCalledWith(stuck.objectPath, true);
    // Mark FAILED before deleting the row
    expect(repoUpdate).toHaveBeenCalledWith(
      { id: stuck.id },
      expect.objectContaining({ status: FileStatus.FAILED }),
    );
    expect(repoDelete).toHaveBeenCalledWith({ id: stuck.id });

    // Order check: update must occur before delete
    const updateOrder = repoUpdate.mock.invocationCallOrder[0];
    const deleteOrder = repoDelete.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(deleteOrder);
  });

  it('does not call update for non-PROCESSING orphaned rows (FAILED/PENDING_UPLOAD path)', async () => {
    const failed: any = {
      id: 'row-2',
      scanId: 'scan-failed',
      status: FileStatus.FAILED,
      objectPath: 'scan/p/scan-failed.zip',
    };
    getMany.mockResolvedValueOnce([failed]);

    await cron.cleanupOrphanedRecords();

    expect(repoDelete).toHaveBeenCalledWith({ id: failed.id });
    expect(repoUpdate).not.toHaveBeenCalled();
  });
});
