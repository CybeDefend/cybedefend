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

  // Distinct creation times, in the order the rows are built.
  let created = 0;
  const row = (id: string, ageMs = 0): FileScan =>
    ({
      id,
      scanId: `scan-${id}`,
      objectPath: `scan/p/${id}.zip`,
      status: FileStatus.PENDING_UPLOAD,
      createdAt: new Date(Date.now() - ageMs - 1_000_000 + created++),
      updatedAt: new Date(),
    }) as FileScan;

  const build = async (
    concurrency?: number,
    extraConfig: Record<string, unknown> = {},
  ) => {
    release = [];
    processUploadedFile = jest.fn(
      () =>
        new Promise<boolean>((resolve) => release.push(() => resolve(true))),
    );
    isFileReady = jest.fn().mockResolvedValue(true);
    updateScanData = jest.fn(() => of({}));
    // Honours what the cron asks of the database: the status, a createdAt
    // cursor (MoreThan), the order and the limit.
    const repo = {
      find: jest.fn(async ({ where, order, take }: any) => {
        let out = rows.filter((r) => r.status === where.status);
        const after = where.createdAt?.value as Date | undefined;
        if (after) out = out.filter((r) => r.createdAt > after);
        if (order?.createdAt) {
          const dir = order.createdAt === 'DESC' ? -1 : 1;
          out = [...out].sort(
            (a, b) => dir * (a.createdAt.getTime() - b.createdAt.getTime()),
          );
        }
        return take === undefined ? out : out.slice(0, take);
      }),
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
            ...extraConfig,
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
    // The busy upload, older, takes the only slot first.
    rows = [row('busy', 3 * HOUR), row('waiting', 2 * HOUR)];
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

  // Each pending upload costs one storage check per tick, in this one pod
  // that serves every project: a project that starts many scans without
  // uploading must not delay the uploads of the others.
  describe('bounded storage checks', () => {
    const inProject = (id: string, projectId: string): FileScan =>
      ({ ...row(id), projectId }) as FileScan;
    const checkedPaths = () =>
      isFileReady.mock.calls.map((c: unknown[]) => c[0] as string);

    it('checks at most FILE_SCAN_PENDING_CHECKS_PER_PROJECT uploads of one project per tick', async () => {
      rows = [
        ...Array.from({ length: 20 }, (_, i) => inProject(`n${i}`, 'noisy')),
        inProject('q', 'quiet'),
      ];
      const cron = await build(1, { FILE_SCAN_PENDING_CHECKS_PER_PROJECT: 5 });
      isFileReady.mockImplementation(
        async (objectPath: string) => objectPath === 'scan/p/q.zip',
      );

      const tick = cron.checkPendingUploads();
      await settle();
      release.forEach((r) => r());
      await tick;

      expect(
        checkedPaths().filter((p) => p.startsWith('scan/p/n')),
      ).toHaveLength(5);
      expect(processUploadedFile).toHaveBeenCalledTimes(1);
      expect(processUploadedFile.mock.calls[0][0].scanId).toBe('scan-q');
    });

    it('checks every pending upload of a project in turn, across ticks', async () => {
      rows = Array.from({ length: 12 }, (_, i) => inProject(`r${i}`, 'one'));
      const cron = await build(1, { FILE_SCAN_PENDING_CHECKS_PER_PROJECT: 5 });
      isFileReady.mockResolvedValue(false);

      for (let i = 0; i < 3; i++) await cron.checkPendingUploads();

      expect(isFileReady).toHaveBeenCalledTimes(15);
      expect(new Set(checkedPaths()).size).toBe(12);
    });

    it('checks at most FILE_SCAN_PENDING_CHECKS_PER_TICK uploads per tick, all projects together', async () => {
      rows = Array.from({ length: 30 }, (_, i) => inProject(`p${i}`, `p${i}`));
      const cron = await build(1, { FILE_SCAN_PENDING_CHECKS_PER_TICK: 10 });
      isFileReady.mockResolvedValue(false);

      await cron.checkPendingUploads();
      expect(isFileReady).toHaveBeenCalledTimes(10);
      await cron.checkPendingUploads();
      expect(new Set(checkedPaths()).size).toBe(20);
    });

    it('bounds the checks by default', async () => {
      rows = Array.from({ length: 50 }, (_, i) => inProject(`d${i}`, 'one'));
      const cron = await build(1);
      isFileReady.mockResolvedValue(false);

      await cron.checkPendingUploads();
      expect(isFileReady.mock.calls.length).toBeLessThan(50);
    });
  });
  describe('bounded tick query', () => {
    const inProject = (id: string, projectId: string): FileScan =>
      ({ ...row(id), projectId }) as FileScan;

    it('asks the database for an ordered, limited page of pending uploads', async () => {
      rows = Array.from({ length: 300 }, (_, i) => inProject(`q${i}`, `p${i}`));
      const cron = await build(1, { FILE_SCAN_PENDING_CHECKS_PER_TICK: 10 });
      isFileReady.mockResolvedValue(false);

      await cron.checkPendingUploads();

      const repo = (cron as any).fileScanRepository;
      const pendingQueries = repo.find.mock.calls
        .map((c: any[]) => c[0])
        .filter((q: any) => q.where.status === FileStatus.PENDING_UPLOAD);
      expect(pendingQueries.length).toBeGreaterThan(0);
      for (const q of pendingQueries) {
        expect(q.order).toEqual({ createdAt: expect.any(String) });
        expect(q.take).toBeLessThanOrEqual(10);
      }
      expect(isFileReady.mock.calls.length).toBeLessThanOrEqual(10);
    });

    it('still checks every pending upload in turn, oldest and newest alike', async () => {
      rows = Array.from({ length: 30 }, (_, i) => inProject(`r${i}`, `p${i}`));
      const cron = await build(1, { FILE_SCAN_PENDING_CHECKS_PER_TICK: 5 });
      isFileReady.mockResolvedValue(false);

      for (let i = 0; i < 10; i++) await cron.checkPendingUploads();

      const checked = new Set(
        isFileReady.mock.calls.map((c: unknown[]) => c[0] as string),
      );
      expect(checked.size).toBe(30);
    });

    it('checks a new upload at the next tick, however many older ones wait', async () => {
      rows = Array.from({ length: 50 }, (_, i) => inProject(`o${i}`, `p${i}`));
      const cron = await build(1, { FILE_SCAN_PENDING_CHECKS_PER_TICK: 5 });
      isFileReady.mockResolvedValue(false);
      // Every older upload has been checked once already.
      for (let i = 0; i < 12; i++) await cron.checkPendingUploads();
      rows.push(inProject('fresh', 'quiet'));
      isFileReady.mockClear();

      await cron.checkPendingUploads();

      expect(
        isFileReady.mock.calls.map((c: unknown[]) => c[0] as string),
      ).toContain('scan/p/fresh.zip');
    });

    it('does not check the same upload in two overlapping ticks', async () => {
      rows = [inProject('a', 'pa'), inProject('b', 'pb'), inProject('c', 'pc')];
      const cron = await build(1);
      const pending: (() => void)[] = [];
      isFileReady.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => pending.push(() => resolve(false))),
      );

      const tick1 = cron.checkPendingUploads();
      await settle();
      const tick2 = cron.checkPendingUploads();
      await settle();
      while (pending.length) {
        pending.shift()!();
        await settle();
      }
      await Promise.all([tick1, tick2]);

      const checked = isFileReady.mock.calls.map((c: unknown[]) => c[0]);
      expect(checked.sort()).toEqual([
        'scan/p/a.zip',
        'scan/p/b.zip',
        'scan/p/c.zip',
      ]);
    });
  });
});
