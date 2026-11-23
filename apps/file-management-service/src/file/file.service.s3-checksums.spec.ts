import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from 'nestjs-pino';

import { FileService } from './file.service';
import { FileScan } from 'src/entities/file.entity';
import { createLoggerMock, createMockRepository } from 'src/test-utils/mocks';
import SecretsService from 'src/core/secrets/secrets.service';

// Since @aws-sdk/client-s3 3.729 a client computes a CRC32 for every request
// that supports one (requestChecksumCalculation WHEN_SUPPORTED). A presigned
// PUT then carries x-amz-checksum-crc32 of the EMPTY body, signed into the
// URL, and an S3 server that checks it (SeaweedFS, the Community Edition's
// storage) refuses the real upload with 400 BadDigest. WHEN_REQUIRED is the
// behaviour before 3.729: a checksum only when the operation requires one or
// the caller asks for it, and a response checked only on ChecksumMode=ENABLED.
// The Community Edition sets it; the closed edition keeps the SDK default,
// unchanged.

const P = '0b6f3c1e-7d2a-4c8e-9f10-2a3b4c5d6e7f';
const S = '1c7a4d2f-8e3b-4d9f-a021-3b4c5d6e7f80';

const mockScanClient = {
  getService: jest.fn().mockReturnValue({}),
} as unknown as ClientGrpc;

const s3Secrets = {
  getSecret: jest.fn((k: string) =>
    k === 'S3_ACCESS_KEY_ID' ? 'AKIATEST' : 'test-secret',
  ),
  ensureCacheLoaded: jest.fn(),
} as unknown as SecretsService;

async function makeService(
  over: Record<string, string> = {},
): Promise<FileService> {
  const config = new ConfigService({
    STORAGE_PROVIDER: 's3',
    S3_ENDPOINT: 'http://storage:9000',
    S3_BUCKET_NAME: 'b',
    AWS_REGION: 'us-east-1',
    ...over,
  });
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      FileService,
      {
        provide: getRepositoryToken(FileScan),
        useValue: createMockRepository<FileScan>(),
      },
      { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
      { provide: ConfigService, useValue: config },
      { provide: SecretsService, useValue: s3Secrets },
      { provide: Logger, useValue: createLoggerMock() },
    ],
  }).compile();
  const service = module.get(FileService);
  // Storage calls stay offline; presigning is a local computation.
  service['s3Client'].send = jest.fn(async (cmd: unknown) => {
    if (cmd instanceof HeadObjectCommand) {
      const err = new Error('not found') as Error & {
        $metadata: { httpStatusCode: number };
      };
      err.name = 'NotFound';
      err.$metadata = { httpStatusCode: 404 };
      throw err;
    }
    return {};
  }) as never;
  return service;
}

async function checksumModes(client: S3Client): Promise<[string, string]> {
  return [
    await client.config.requestChecksumCalculation(),
    await client.config.responseChecksumValidation(),
  ];
}

/** Every query parameter of a signed URL that names a checksum. */
function checksumParams(url: string): string[] {
  return [...new URL(url).searchParams.keys()].filter((k) =>
    /checksum/i.test(k),
  );
}

describe('FileService — S3 checksums only when required (Community Edition)', () => {
  const saved = process.env.CYBEDEFEND_EDITION;
  afterEach(() => {
    if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = saved;
  });
  beforeEach(() => {
    process.env.CYBEDEFEND_EDITION = 'community';
    (s3Secrets.getSecret as jest.Mock).mockImplementation((k: string) =>
      k === 'S3_ACCESS_KEY_ID' ? 'AKIATEST' : 'test-secret',
    );
  });

  it('builds the storage client and the presign client with WHEN_REQUIRED', async () => {
    const service = await makeService({
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
    });
    const storage = service['s3Client'];
    const presign = service['s3PresignClient'];
    expect(presign).not.toBe(storage);
    expect(await checksumModes(storage)).toEqual([
      'WHEN_REQUIRED',
      'WHEN_REQUIRED',
    ]);
    expect(await checksumModes(presign)).toEqual([
      'WHEN_REQUIRED',
      'WHEN_REQUIRED',
    ]);
  });

  it('builds the single client with WHEN_REQUIRED when no public endpoint is set', async () => {
    const service = await makeService();
    expect(service['s3PresignClient']).toBe(service['s3Client']);
    expect(await checksumModes(service['s3Client'])).toEqual([
      'WHEN_REQUIRED',
      'WHEN_REQUIRED',
    ]);
  });

  it.each([
    ['with a public endpoint', { S3_PUBLIC_ENDPOINT: 'http://localhost:9000' }],
    ['without a public endpoint', {}],
  ])(
    'signs presigned PUT URLs with no checksum parameter (%s)',
    async (_label, over: Record<string, string>) => {
      const service = await makeService(over);

      const scanUpload = await service.uploadFile({
        scanId: S,
        projectId: P,
        typeScan: 'sast',
      });
      const diffUpload = await service.signObjectPut(`scan/${P}/${S}.zip`, {
        contentType: 'application/zip',
        ttlSeconds: 60,
        minBytes: 0,
        maxBytes: 100,
        audience: 'browser',
      });
      const importUpload = await service.requestImportUploadUrl({
        scanId: S,
        projectId: P,
        contentEncoding: 'gzip',
        contentLength: 1024,
      });

      for (const url of [
        scanUpload.url,
        diffUpload.uploadUrl,
        importUpload.uploadUrl,
      ]) {
        expect(new URL(url).searchParams.get('X-Amz-Signature')).toMatch(
          /^[0-9a-f]{64}$/,
        );
        expect(checksumParams(url)).toEqual([]);
      }
    },
  );
});

// The closed edition's case (SDK default kept) is tested with the closed
// edition.
