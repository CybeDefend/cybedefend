import { ConfigService } from '@nestjs/config';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { status } from '@grpc/grpc-js';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Logger } from 'nestjs-pino';

import { FileService } from './file.service';
import { FileScan } from 'src/entities/file.entity';
import { createLoggerMock, createMockRepository } from 'src/test-utils/mocks';
import SecretsService from 'src/core/secrets/secrets.service';
import {
  IMPORT_DOWNLOAD_TTL_SECONDS,
  IMPORT_MAX_UPLOAD_BYTES,
  IMPORT_UPLOAD_TTL_SECONDS,
} from './import-object';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/s3'),
}));
import { getSignedUrl as mockedGetSignedUrl } from '@aws-sdk/s3-request-presigner';

const P = '0b6f3c1e-7d2a-4c8e-9f10-2a3b4c5d6e7f';
const S = '1c7a4d2f-8e3b-4d9f-a021-3b4c5d6e7f80';
const OTHER = '2d8b5e30-9f4c-4ea0-b132-4c5d6e7f8091';
const KEY = `import/${P}/${S}.sarif`;
const C = '3e9c6f41-a05d-4fb1-8243-5d6e7f8091a2';
const D = '4fad7052-b16e-40c2-9354-6e7f8091a2b3';
const CKEY = `import/${P}/${S}/${C}.sarif`;

const NOW = 1_800_000_000_000;

const mockScanClient = {
  getService: jest.fn().mockReturnValue({}),
} as unknown as ClientGrpc;

function makeConfig(over: Record<string, unknown> = {}): ConfigService {
  return new ConfigService({
    STORAGE_PROVIDER: 's3',
    S3_ENDPOINT: 'http://minio:9000',
    S3_BUCKET_NAME: 'b',
    AWS_REGION: 'eu-west-1',
    ...over,
  } as Record<string, string>);
}

const s3Secrets = {
  getSecret: jest.fn(() => 'k'),
  ensureCacheLoaded: jest.fn(),
} as unknown as SecretsService;

async function makeService(
  over: Record<string, unknown> = {},
  repo: ReturnType<
    typeof createMockRepository<FileScan>
  > = createMockRepository<FileScan>(),
): Promise<{
  service: FileService;
  repo: ReturnType<typeof createMockRepository<FileScan>>;
  logger: ReturnType<typeof createLoggerMock>;
}> {
  const logger = createLoggerMock();
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      FileService,
      { provide: getRepositoryToken(FileScan), useValue: repo },
      { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
      { provide: ConfigService, useValue: makeConfig(over) },
      { provide: SecretsService, useValue: s3Secrets },
      { provide: Logger, useValue: logger },
    ],
  }).compile();
  return { service: module.get(FileService), repo, logger };
}

async function expectRpcCode(
  p: Promise<unknown>,
  code: number,
  message?: string,
) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(RpcException);
  expect((err as RpcException).getError()).toEqual(
    expect.objectContaining({ code, ...(message ? { message } : {}) }),
  );
}

describe('FileService — import object', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    (mockedGetSignedUrl as jest.Mock).mockResolvedValue(
      'https://signed.example/s3',
    );
    (s3Secrets.getSecret as jest.Mock).mockImplementation(() => 'k');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('requestImportUploadUrl (S3)', () => {
    it('signs a PUT for the import key with its size and type', async () => {
      const { service } = await makeService();
      service['s3Client'] = { send: jest.fn() } as never;

      const res = await service.requestImportUploadUrl({
        scanId: S,
        projectId: P,
        contentEncoding: 'gzip',
        contentLength: 1024,
      });

      expect(mockedGetSignedUrl).toHaveBeenCalledTimes(1);
      const [, cmd, opts] = (mockedGetSignedUrl as jest.Mock).mock.calls[0];
      expect(cmd).toBeInstanceOf(PutObjectCommand);
      expect(cmd.input).toEqual({
        Bucket: 'b',
        Key: KEY,
        ContentType: 'application/gzip',
        ContentLength: 1024,
      });
      expect(opts).toEqual({ expiresIn: IMPORT_UPLOAD_TTL_SECONDS });
      expect(res).toEqual({
        uploadUrl: 'https://signed.example/s3',
        objectKey: KEY,
        uploadExpiresAtMs: NOW + IMPORT_UPLOAD_TTL_SECONDS * 1000,
        uploadHeaders: { 'Content-Type': 'application/gzip' },
      });
    });

    it('keeps the same key for an uncompressed file', async () => {
      const { service } = await makeService();
      service['s3Client'] = { send: jest.fn() } as never;

      await service.requestImportUploadUrl({
        scanId: S,
        projectId: P,
        contentEncoding: 'identity',
        contentLength: 512,
      });

      const [, cmd] = (mockedGetSignedUrl as jest.Mock).mock.calls[0];
      expect(cmd.input).toMatchObject({
        Key: KEY,
        ContentType: 'application/sarif+json',
        ContentLength: 512,
      });
    });

    it.each([0, IMPORT_MAX_UPLOAD_BYTES + 1])(
      'refuses a size of %d',
      async (contentLength) => {
        const { service } = await makeService();
        service['s3Client'] = { send: jest.fn() } as never;

        await expectRpcCode(
          service.requestImportUploadUrl({
            scanId: S,
            projectId: P,
            contentEncoding: 'identity',
            contentLength,
          }),
          status.INVALID_ARGUMENT,
        );
        expect(mockedGetSignedUrl).not.toHaveBeenCalled();
      },
    );

    it('refuses an unknown encoding', async () => {
      const { service } = await makeService();
      service['s3Client'] = { send: jest.fn() } as never;

      await expectRpcCode(
        service.requestImportUploadUrl({
          scanId: S,
          projectId: P,
          contentEncoding: 'br',
          contentLength: 1024,
        }),
        status.INVALID_ARGUMENT,
      );
      expect(mockedGetSignedUrl).not.toHaveBeenCalled();
    });

    it('refuses a scan id that is not a uuid', async () => {
      const { service } = await makeService();
      service['s3Client'] = { send: jest.fn() } as never;

      await expectRpcCode(
        service.requestImportUploadUrl({
          scanId: 'not-a-uuid',
          projectId: P,
          contentEncoding: 'identity',
          contentLength: 1024,
        }),
        status.INVALID_ARGUMENT,
      );
      expect(mockedGetSignedUrl).not.toHaveBeenCalled();
    });

    it('creates no file_scan row', async () => {
      const repo = createMockRepository<FileScan>();
      const { service } = await makeService({}, repo);
      service['s3Client'] = { send: jest.fn() } as never;

      await service.requestImportUploadUrl({
        scanId: S,
        projectId: P,
        contentEncoding: 'identity',
        contentLength: 1024,
      });

      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('getImportDownloadUrl', () => {
    it('signs a GET of 20 minutes and returns the size', async () => {
      const { service } = await makeService();
      const send = jest.fn(async (cmd: unknown) => {
        if (cmd instanceof HeadObjectCommand) {
          return { ContentLength: 2048 };
        }
        return {};
      });
      service['s3Client'] = { send } as never;

      const res = await service.getImportDownloadUrl({
        projectId: P,
        objectKey: KEY,
      });

      expect(send).toHaveBeenCalledTimes(1);
      expect((send.mock.calls[0][0] as HeadObjectCommand).input).toEqual({
        Bucket: 'b',
        Key: KEY,
      });
      expect(mockedGetSignedUrl).toHaveBeenCalledTimes(1);
      const [, cmd, opts] = (mockedGetSignedUrl as jest.Mock).mock.calls[0];
      expect(cmd).toBeInstanceOf(GetObjectCommand);
      expect(cmd.input).toEqual({ Bucket: 'b', Key: KEY });
      expect(opts).toEqual({ expiresIn: IMPORT_DOWNLOAD_TTL_SECONDS });
      expect(res).toEqual({
        url: 'https://signed.example/s3',
        sizeBytes: 2048,
      });
    });

    it('answers NOT_FOUND for a missing object', async () => {
      const { service } = await makeService();
      service['s3Client'] = {
        send: jest.fn(async () => {
          const err = new Error('not found') as Error & {
            name: string;
            $metadata: { httpStatusCode: number };
          };
          err.name = 'NotFound';
          err.$metadata = { httpStatusCode: 404 };
          throw err;
        }),
      } as never;

      await expectRpcCode(
        service.getImportDownloadUrl({ projectId: P, objectKey: KEY }),
        status.NOT_FOUND,
      );
      expect(mockedGetSignedUrl).not.toHaveBeenCalled();
    });

    it('refuses a key of another project', async () => {
      const { service } = await makeService();
      const send = jest.fn();
      service['s3Client'] = { send } as never;

      await expectRpcCode(
        service.getImportDownloadUrl({
          projectId: P,
          objectKey: `import/${OTHER}/${S}.sarif`,
        }),
        status.INVALID_ARGUMENT,
      );
      expect(send).not.toHaveBeenCalled();
      expect(mockedGetSignedUrl).not.toHaveBeenCalled();
    });

    it('answers IMPORT_STORAGE_UNAVAILABLE when storage fails', async () => {
      const { service, logger } = await makeService();
      service['s3Client'] = {
        send: jest.fn(async () => {
          throw Object.assign(new Error('boom'), {
            $metadata: { httpStatusCode: 500 },
          });
        }),
      } as never;

      await expectRpcCode(
        service.getImportDownloadUrl({ projectId: P, objectKey: KEY }),
        status.UNAVAILABLE,
        'IMPORT_STORAGE_UNAVAILABLE',
      );
      // The failure is logged without any signed URL.
      const logged = JSON.stringify((logger.error as jest.Mock).mock.calls);
      expect(logged).not.toContain('https://');
    });
  });

  describe('deleteImportObject', () => {
    it('deletes the key and is idempotent', async () => {
      const { service } = await makeService();
      const send = jest.fn(async (cmd: unknown) => {
        if (cmd instanceof DeleteObjectCommand) {
          const err = new Error('not found') as Error & { name: string };
          err.name = 'NotFound';
          throw err;
        }
        return {};
      });
      service['s3Client'] = { send } as never;

      const res = await service.deleteImportObject({
        projectId: P,
        objectKey: KEY,
      });

      expect(send).toHaveBeenCalledTimes(1);
      expect((send.mock.calls[0][0] as DeleteObjectCommand).input).toEqual({
        Bucket: 'b',
        Key: KEY,
      });
      expect(res).toEqual({ success: true });
    });

    it('refuses a key of another project', async () => {
      const { service } = await makeService();
      const send = jest.fn();
      service['s3Client'] = { send } as never;

      await expectRpcCode(
        service.deleteImportObject({
          projectId: P,
          objectKey: `import/${OTHER}/${S}.sarif`,
        }),
        status.INVALID_ARGUMENT,
      );
      expect(send).not.toHaveBeenCalled();
    });

    it('answers IMPORT_STORAGE_UNAVAILABLE when the delete fails', async () => {
      const { service } = await makeService();
      service['s3Client'] = {
        send: jest.fn(async () => {
          throw Object.assign(new Error('denied'), {
            $metadata: { httpStatusCode: 403 },
          });
        }),
      } as never;

      await expectRpcCode(
        service.deleteImportObject({ projectId: P, objectKey: KEY }),
        status.UNAVAILABLE,
        'IMPORT_STORAGE_UNAVAILABLE',
      );
    });
  });

  describe('the SBOM object of an sca import', () => {
    const SBOM_KEY = `import/${P}/${S}.sbom`;

    it('RequestImportUploadUrl with kind sbom signs import/<p>/<s>.sbom as CycloneDX JSON', async () => {
      const { service } = await makeService();
      service['s3Client'] = { send: jest.fn() } as never;

      const res = await service.requestImportUploadUrl({
        scanId: S,
        projectId: P,
        contentEncoding: 'identity',
        contentLength: 2048,
        kind: 'sbom',
      });

      const [, cmd] = (mockedGetSignedUrl as jest.Mock).mock.calls[0];
      expect(cmd.input).toEqual({
        Bucket: 'b',
        Key: SBOM_KEY,
        ContentType: 'application/vnd.cyclonedx+json',
        ContentLength: 2048,
      });
      expect(res.objectKey).toBe(SBOM_KEY);
    });

    it('RequestImportUploadUrl with kind sbom and container_id signs the per-container import/<p>/<s>/<c>.sbom', async () => {
      const { service } = await makeService();
      service['s3Client'] = { send: jest.fn() } as never;

      const res = await service.requestImportUploadUrl({
        scanId: S,
        projectId: P,
        containerId: C,
        contentEncoding: 'gzip',
        contentLength: 4096,
        kind: 'sbom',
      });

      const key = `import/${P}/${S}/${C}.sbom`;
      const [, cmd] = (mockedGetSignedUrl as jest.Mock).mock.calls[0];
      expect(cmd.input).toEqual({
        Bucket: 'b',
        Key: key,
        ContentType: 'application/gzip',
        ContentLength: 4096,
      });
      expect(res.objectKey).toBe(key);
    });

    it('GetImportDownloadUrl and DeleteImportObject accept the per-container SBOM key', async () => {
      const { service } = await makeService();
      const send = jest.fn(async () => ({ ContentLength: 10 }));
      service['s3Client'] = { send } as never;
      const key = `import/${P}/${S}/${C}.sbom`;

      await expect(
        service.getImportDownloadUrl({ projectId: P, objectKey: key }),
      ).resolves.toEqual({ url: 'https://signed.example/s3', sizeBytes: 10 });
      await expect(
        service.deleteImportObject({ projectId: P, objectKey: key }),
      ).resolves.toEqual({ success: true });
    });

    it('RequestImportUploadUrl refuses another kind, and an SBOM with a malformed container, and signs nothing', async () => {
      const { service } = await makeService();
      service['s3Client'] = { send: jest.fn() } as never;
      for (const extra of [
        { kind: 'spdx' },
        { kind: 'sbom', containerId: 'not-a-uuid' },
        { kind: 'sbom', containerId: '' },
      ]) {
        await expectRpcCode(
          service.requestImportUploadUrl({
            scanId: S,
            projectId: P,
            contentEncoding: 'identity',
            contentLength: 512,
            ...extra,
          }),
          status.INVALID_ARGUMENT,
        );
      }
      expect(mockedGetSignedUrl).not.toHaveBeenCalled();
    });

    it('GetImportDownloadUrl and DeleteImportObject accept the SBOM key', async () => {
      const { service } = await makeService();
      const send = jest.fn(async () => ({ ContentLength: 10 }));
      service['s3Client'] = { send } as never;

      await expect(
        service.getImportDownloadUrl({ projectId: P, objectKey: SBOM_KEY }),
      ).resolves.toEqual({ url: 'https://signed.example/s3', sizeBytes: 10 });
      await expect(
        service.deleteImportObject({ projectId: P, objectKey: SBOM_KEY }),
      ).resolves.toEqual({ success: true });
    });
  });

  describe('per-container import object (Community cluster scans)', () => {
    it('RequestImportUploadUrl with container_id returns the per-container key', async () => {
      const { service } = await makeService();
      service['s3Client'] = { send: jest.fn() } as never;

      const res = await service.requestImportUploadUrl({
        scanId: S,
        projectId: P,
        contentEncoding: 'identity',
        contentLength: 512,
        containerId: C,
      });

      const [, cmd] = (mockedGetSignedUrl as jest.Mock).mock.calls[0];
      expect(cmd).toBeInstanceOf(PutObjectCommand);
      expect(cmd.input).toEqual({
        Bucket: 'b',
        Key: CKEY,
        ContentType: 'application/sarif+json',
        ContentLength: 512,
      });
      expect(res.objectKey).toBe(CKEY);
    });

    it.each(['', 'not-a-uuid', '../x', `${C}/${D}`])(
      'RequestImportUploadUrl refuses the container id %j and signs nothing',
      async (containerId) => {
        const { service } = await makeService();
        service['s3Client'] = { send: jest.fn() } as never;

        await expectRpcCode(
          service.requestImportUploadUrl({
            scanId: S,
            projectId: P,
            contentEncoding: 'identity',
            contentLength: 512,
            containerId,
          }),
          status.INVALID_ARGUMENT,
        );
        expect(mockedGetSignedUrl).not.toHaveBeenCalled();
      },
    );

    it('GetImportDownloadUrl accepts the per-container key', async () => {
      const { service } = await makeService();
      const send = jest.fn(async () => ({ ContentLength: 10 }));
      service['s3Client'] = { send } as never;

      const res = await service.getImportDownloadUrl({
        projectId: P,
        objectKey: CKEY,
      });

      expect((send.mock.calls[0] as unknown[])[0]).toBeInstanceOf(
        HeadObjectCommand,
      );
      const [, cmd] = (mockedGetSignedUrl as jest.Mock).mock.calls[0];
      expect(cmd.input).toEqual({ Bucket: 'b', Key: CKEY });
      expect(res).toEqual({ url: 'https://signed.example/s3', sizeBytes: 10 });
    });

    it('DeleteImportObject accepts the per-container key', async () => {
      const { service } = await makeService();
      const send = jest.fn(async () => ({}));
      service['s3Client'] = { send } as never;

      const res = await service.deleteImportObject({
        projectId: P,
        objectKey: CKEY,
      });

      const cmd = (send.mock.calls[0] as unknown[])[0] as DeleteObjectCommand;
      expect(cmd).toBeInstanceOf(DeleteObjectCommand);
      expect(cmd.input).toEqual({ Bucket: 'b', Key: CKEY });
      expect(res).toEqual({ success: true });
    });

    const refused = [
      `import/${P}/${S}/../x.sarif`,
      `import/${P}/${S}/${C}/${D}.sarif`,
      `import/${OTHER}/${S}/${C}.sarif`,
    ];

    it.each(refused)(
      'GetImportDownloadUrl refuses %s without touching storage',
      async (objectKey) => {
        const { service } = await makeService();
        const send = jest.fn();
        service['s3Client'] = { send } as never;

        await expectRpcCode(
          service.getImportDownloadUrl({ projectId: P, objectKey }),
          status.INVALID_ARGUMENT,
        );
        expect(send).not.toHaveBeenCalled();
        expect(mockedGetSignedUrl).not.toHaveBeenCalled();
      },
    );

    it.each(refused)(
      'DeleteImportObject refuses %s without touching storage',
      async (objectKey) => {
        const { service } = await makeService();
        const send = jest.fn();
        service['s3Client'] = { send } as never;

        await expectRpcCode(
          service.deleteImportObject({ projectId: P, objectKey }),
          status.INVALID_ARGUMENT,
        );
        expect(send).not.toHaveBeenCalled();
      },
    );
  });
});
