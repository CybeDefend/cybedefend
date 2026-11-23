import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';

import { FileCron } from './file.cron';
import { FileService } from './file.service';
import { FileScan, FileStatus } from 'src/entities/file.entity';
import { createLoggerMock } from 'src/test-utils/mocks';

/**
 * The cron runs every 5 seconds and its ticks overlap: every upload it picks is
 * filtered in this one pod, which holds each archive's buffers at the same
 * time. FILE_SCAN_PROCESSING_CONCURRENCY bounds how many run at once; an
 * upload that is ready waits for a free slot, and is never failed as "upload
 * timed out" while it waits.
 */
describe('FileCron.checkPendingUploads', () => {
  const HOUR = 60 * 60 * 1000;
  let rows: FileScan[];
  let processUploadedFile: jest.Mock;
  let isFileReady: jest.Mock;
  let updateScanData: jest.Mock;
  let release: (() => void)[];

  const row = (id: string, ageMs = 0): FileScan =>
    ({
      id,
      scanId: `scan-${id}`,
      objectPath: `scan/p/${id}.zip`,
      status: FileStatus.PENDING_UPLOAD,
      createdAt: new Date(Date.now() - ageMs),
      updatedAt: new Date(),
    }) as FileScan;

  const build = async (concurrency?: number) => {
    release = [];
    processUploadedFile = jest.fn(
      () =>
        new Promise<boolean>((resolve) => release.push(() => resolve(true))),
    );
    isFileReady = jest.fn().mockResolvedValue(true);
    updateScanData = jest.fn(() => of({}));
    const repo = {
      find: jest.fn(async ({ where }: any) =>
        rows.filter((r) => r.status === where.status),
      ),
      findOne: jest.fn(async ({ where }: any) =>
        rows.find((r) => r.scanId === where.scanId),
      ),
      update: jest.fn(async ({ id }: any, patch: any) => {
        const r = rows.find((x) => x.id === id);
        if (r) Object.assign(r, patch);
      }),
    };
    const module = await Test.createTestingModule({
      providers: [
        FileCron,
        { provide: getRepositoryToken(FileScan), useValue: repo },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: () => ({ updateScanData }),
          } as unknown as ClientGrpc,
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            FILE_SCAN_UPLOAD_TIMEOUT_MINUTES: 30,
            FILE_SCAN_PROCESSING_TIMEOUT_MINUTES: 15,
            ...(concurrency === undefined
              ? {}
              : { FILE_SCAN_PROCESSING_CONCURRENCY: concurrency }),
          }),
        },
        {
          provide: FileService,
          useValue: {
            processUploadedFile,
            isFileReady,
            deleteFileFromStorage: jest.fn(),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
      ],
    }).compile();
    const cron = module.get(FileCron);
    await cron.onModuleInit();
    return cron;
  };

  const settle = () => new Promise((r) => setImmediate(r));

  it('processes at most FILE_SCAN_PROCESSING_CONCURRENCY uploads at once, across ticks', async () => {
    rows = [row('a'), row('b'), row('c')];
    const cron = await build(2);

    const tick1 = cron.checkPendingUploads();
    await settle();
    const tick2 = cron.checkPendingUploads();
    await settle();
    expect(processUploadedFile).toHaveBeenCalledTimes(2);
    expect(rows.find((r) => r.id === 'c')!.status).toBe(
      FileStatus.PENDING_UPLOAD,
    );

    release.shift()!();
    await settle();
    const tick3 = cron.checkPendingUploads();
    await settle();
    expect(processUploadedFile).toHaveBeenCalledTimes(3);

    release.forEach((r) => r());
    await Promise.all([tick1, tick2, tick3]);
  });

  it('processes one upload at a time by default', async () => {
    rows = [row('a'), row('b')];
    const cron = await build();

    const tick = cron.checkPendingUploads();
    await settle();
    expect(processUploadedFile).toHaveBeenCalledTimes(1);

    release.forEach((r) => r());
    await tick;
  });

  it('does not fail as timed out an upload that is ready and waits for a slot', async () => {
    rows = [row('busy'), row('waiting', 2 * HOUR)];
    rows[0].createdAt = new Date();
    const cron = await build(1);

    const tick1 = cron.checkPendingUploads();
    await settle();
    await cron.checkPendingUploads();
    expect(updateScanData).not.toHaveBeenCalled();
    expect(rows.find((r) => r.id === 'waiting')!.status).toBe(
      FileStatus.PENDING_UPLOAD,
    );

    release.forEach((r) => r());
    await tick1;
  });

  it('still fails an upload that never arrived', async () => {
    rows = [row('never', 2 * HOUR)];
    const cron = await build(1);
    isFileReady.mockResolvedValue(false);

    await cron.checkPendingUploads();

    expect(updateScanData).toHaveBeenCalledWith(
      expect.objectContaining({ scanId: 'scan-never', state: 'failed' }),
    );
    expect(processUploadedFile).not.toHaveBeenCalled();
  });

  // Nothing was ever processed: the scan says the archive never arrived,
  // with its code and the deadline named, and it ends (an end time), so the
  // project is free for a new scan and the failure is dated.
  it('fails an upload that never arrived with its code, the deadline named and an end time', async () => {
    rows = [row('late', 2 * HOUR)];
    const cron = await build(1);
    isFileReady.mockResolvedValue(false);

    await cron.checkPendingUploads();

    const call = updateScanData.mock.calls[0][0];
    expect(call).toMatchObject({
      scanId: 'scan-late',
      state: 'failed',
      errorCode: 98,
      errorCategory: 'archive',
    });
    expect(call.errorMessage).toMatch(/^ARCHIVE_NOT_RECEIVED: /);
    expect(call.errorMessage).toMatch(/30 minutes/);
    expect(call.errorMessage).not.toMatch(/Processing exceeded/);
    expect(Number.isNaN(Date.parse(call.endTime))).toBe(false);
  });
});
