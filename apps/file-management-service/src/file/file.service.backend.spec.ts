import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { status } from '@grpc/grpc-js';
import { FileService } from './file.service';
import { FileScan } from 'src/entities/file.entity';
import { createLoggerMock, createMockRepository } from 'src/test-utils/mocks';
import SecretsService from 'src/core/secrets/secrets.service';
import {
  OBJECT_STORAGE_BACKEND,
  ObjectStorageBackend,
} from '../edition/ports/object-storage-backend.port';

jest.mock('uuid', () => ({ v6: () => 'mock-uuid' }));

/** An edition backend whose every call is a mock. */
function fakeBackend(): jest.Mocked<ObjectStorageBackend> {
  return {
    label: 'Fake',
    init: jest.fn().mockResolvedValue(undefined),
    signPut: jest
      .fn()
      .mockResolvedValue({ url: 'https://put', signedHeaders: { 'x-b': '1' } }),
    signGet: jest.fn().mockResolvedValue('https://get'),
    exists: jest.fn().mockResolvedValue(true),
    stat: jest.fn(),
    isNotFound: jest.fn((err: unknown) => (err as { nf?: boolean })?.nf),
    createReadStream: jest.fn(),
    uploadFile: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    listVersions: jest.fn(),
    deleteVersion: jest.fn(),
  } as unknown as jest.Mocked<ObjectStorageBackend>;
}

describe('FileService with an edition storage backend', () => {
  let repo: ReturnType<typeof createMockRepository<FileScan>>;
  let backend: jest.Mocked<ObjectStorageBackend>;
  let service: FileService;

  // No S3 key in the environment nor in the secrets: a bound backend replaces
  // the S3-compatible store, whose client is then never built.
  const build = async (bound: ObjectStorageBackend | null) => {
    repo = createMockRepository<FileScan>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        { provide: getRepositoryToken(FileScan), useValue: repo },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: jest.fn().mockReturnValue({}),
          } as unknown as ClientGrpc,
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            FILE_SCAN_MIN_FILE_SIZE_BYTES: 10,
            FILE_SCAN_MIN_FILE_AGE_SECONDS: 0,
          }),
        },
        {
          provide: SecretsService,
          useValue: { getSecret: () => undefined } as unknown as SecretsService,
        },
        { provide: Logger, useValue: createLoggerMock() },
        { provide: OBJECT_STORAGE_BACKEND, useValue: bound },
      ],
    }).compile();
    return module.get(FileService);
  };

  beforeEach(async () => {
    backend = fakeBackend();
    service = await build(backend);
    await service.onModuleInit();
  });

  it('starts the backend and builds no S3 client', () => {
    expect(backend.init).toHaveBeenCalledTimes(1);
    expect(service['s3Client']).toBeUndefined();
    expect(service.storageTarget()).toEqual({ provider: 'backend', backend });
  });

  it('without a backend, needs the S3 credentials', async () => {
    await expect(build(null)).rejects.toThrow('Missing S3 credentials');
  });

  it('signs the scan upload as a create-only, size-bounded PUT', async () => {
    const res = await service.uploadFile({
      projectId: 'p1',
      scanId: 's1',
      typeScan: 'sast',
    } as never);

    expect(res.url).toBe('https://put');
    expect(backend.signPut).toHaveBeenCalledWith('scan/p1/s1.zip', {
      contentType: 'application/zip',
      expiresAtMs: expect.any(Number),
      createOnly: true,
      sizeRange: { min: 0, max: 5368709120 },
    });
  });

  it('returns the headers the backend signed with the Content-Type', async () => {
    const res = await service.signObjectPut('scan/p1/s1.zip', {
      contentType: 'application/zip',
      ttlSeconds: 60,
      minBytes: 1,
      maxBytes: 9,
    });

    expect(res.uploadHeaders).toEqual({
      'Content-Type': 'application/zip',
      'x-b': '1',
    });
    expect(backend.signPut).toHaveBeenCalledWith('scan/p1/s1.zip', {
      contentType: 'application/zip',
      expiresAtMs: res.expiresAtMs,
      createOnly: true,
      sizeRange: { min: 1, max: 9 },
    });
  });

  it('signs the first existing download key', async () => {
    repo.findOne.mockResolvedValue({
      scanId: 's1',
      objectPath: 'scan/p1/s1.zip',
    } as FileScan);
    backend.exists.mockImplementation(async (key) => key.endsWith('.zip'));

    const res = await service.getDownloadUrl({ scanId: 's1' } as never);

    expect(res.url).toBe('https://get');
    expect(backend.exists).toHaveBeenCalledWith('filtered/p1/s1.zip');
    expect(backend.signGet).toHaveBeenCalledWith('filtered/p1/s1.zip', {
      expiresAtMs: expect.any(Number),
    });
  });

  it('checks readiness from the stored object', async () => {
    backend.stat.mockResolvedValue({
      size: 100,
      updated: new Date(Date.now() - 60_000),
      contentType: 'application/zip',
    });
    await expect(service.isFileReady('scan/p1/s1.zip')).resolves.toBe(true);

    backend.stat.mockRejectedValue({ nf: true });
    await expect(service.isFileReady('scan/p1/s1.zip')).resolves.toBe(false);
  });

  it('deletes every key of a scan and names the backend', async () => {
    repo.findOne.mockResolvedValue({
      scanId: 's1',
      projectId: 'p1',
      objectPath: 'scan/p1/s1.zip',
    } as FileScan);

    const res = await service.deleteFile({ scanId: 's1' } as never);

    expect(backend.delete.mock.calls.map((c) => c[0])).toEqual([
      'scan/p1/s1.zip',
      'filtered/p1/s1.zip',
      'scan/p1/s1.filtered.zip',
      'scan/p1/s1.history.tar',
    ]);
    expect(res).toEqual({ success: true, message: 'Deleted from Fake' });
  });

  describe('history artifact', () => {
    it('uploads a history artifact under its own key without a FileScan row', async () => {
      const res = await service.uploadFile({
        projectId: 'p1',
        scanId: 's1',
        typeScan: 'sast',
        artifact: 'history',
      } as never);

      expect(res.url).toBe('https://put');
      expect(backend.signPut).toHaveBeenCalledWith('scan/p1/s1.history.tar', {
        contentType: 'application/x-tar',
        expiresAtMs: expect.any(Number),
        createOnly: true,
        sizeRange: { min: 0, max: 5368709120 },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects an unknown artifact kind', async () => {
      await expect(
        service.uploadFile({
          projectId: 'p1',
          scanId: 's1',
          typeScan: 'sast',
          artifact: 'bogus',
        } as never),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
      expect(backend.signPut).not.toHaveBeenCalled();
    });

    it('the default artifact is unchanged', async () => {
      await service.uploadFile({
        projectId: 'p1',
        scanId: 's1',
        typeScan: 'sast',
        artifact: 'archive',
      } as never);
      expect(backend.signPut.mock.calls[0][0]).toBe('scan/p1/s1.zip');
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('signs a download of the history artifact', async () => {
      repo.findOne.mockResolvedValue({
        scanId: 's1',
        projectId: 'p1',
        objectPath: 'scan/p1/s1.zip',
      } as FileScan);

      const res = await service.getDownloadUrl({
        scanId: 's1',
        artifact: 'history',
      } as never);

      expect(res.url).toBe('https://get');
      expect(backend.exists).toHaveBeenCalledTimes(1);
      expect(backend.signGet).toHaveBeenCalledWith('scan/p1/s1.history.tar', {
        expiresAtMs: expect.any(Number),
      });
    });

    it('signs a history download for 3 hours', async () => {
      repo.findOne.mockResolvedValue({
        scanId: 's1',
        projectId: 'p1',
        objectPath: 'scan/p1/s1.zip',
      } as FileScan);
      const before = Date.now();
      await service.getDownloadUrl({
        scanId: 's1',
        artifact: 'history',
      } as never);
      const at = backend.signGet.mock.calls[0][1].expiresAtMs;
      const ttl = 3 * 60 * 60 * 1000;
      expect(at).toBeGreaterThanOrEqual(before + ttl);
      expect(at).toBeLessThanOrEqual(Date.now() + ttl);
    });

    it('answers NOT_FOUND when a scan has no history artifact', async () => {
      repo.findOne.mockResolvedValue({
        scanId: 's1',
        projectId: 'p1',
        objectPath: 'scan/p1/s1.zip',
      } as FileScan);
      backend.exists.mockImplementation(async (key) => !key.endsWith('.tar'));

      await expect(
        service.getDownloadUrl({ scanId: 's1', artifact: 'history' } as never),
      ).rejects.toMatchObject({ error: { code: status.NOT_FOUND } });
      expect(backend.signGet).not.toHaveBeenCalled();
    });

    it("the cron cleanup also deletes the scan's history tar", async () => {
      await service.deleteFileFromStorage('scan/p1/s1.zip', true);
      expect(backend.delete).toHaveBeenCalledWith('scan/p1/s1.history.tar');
    });

    it('deleteFile sweeps the history artifact', async () => {
      repo.findOne.mockResolvedValue({
        scanId: 's1',
        projectId: 'p1',
        objectPath: 'scan/p1/s1.zip',
      } as FileScan);
      await service.deleteFile({ scanId: 's1' } as never);
      expect(backend.delete).toHaveBeenCalledWith('scan/p1/s1.history.tar');
    });
  });
});
