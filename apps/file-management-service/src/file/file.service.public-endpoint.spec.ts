import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { Logger } from 'nestjs-pino';

import { FileService } from './file.service';
import { FileScan } from 'src/entities/file.entity';
import { createLoggerMock, createMockRepository } from 'src/test-utils/mocks';
import SecretsService from 'src/core/secrets/secrets.service';
import { validationSchema } from '../core/config/validation.schema';

// The presigner is NOT mocked here. The URLs are signed offline
// (SigV4 is a local computation) with fake credentials, so the spec asserts
// the origin each signed URL carries: S3_PUBLIC_ENDPOINT for the URLs a
// browser or an agent receives, S3_ENDPOINT for the internal ones.

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

function makeConfig(over: Record<string, unknown> = {}): ConfigService {
  return new ConfigService({
    STORAGE_PROVIDER: 's3',
    S3_ENDPOINT: 'http://minio:9000',
    S3_BUCKET_NAME: 'b',
    AWS_REGION: 'eu-west-1',
    ...over,
  } as Record<string, string>);
}

async function makeService(
  over: Record<string, unknown> = {},
  repo: ReturnType<
    typeof createMockRepository<FileScan>
  > = createMockRepository<FileScan>(),
): Promise<{
  service: FileService;
  repo: ReturnType<typeof createMockRepository<FileScan>>;
}> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      FileService,
      { provide: getRepositoryToken(FileScan), useValue: repo },
      { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
      { provide: ConfigService, useValue: makeConfig(over) },
      { provide: SecretsService, useValue: s3Secrets },
      { provide: Logger, useValue: createLoggerMock() },
    ],
  }).compile();
  return { service: module.get(FileService), repo };
}

type SendImpl = (cmd: unknown) => Promise<unknown>;

/** Storage calls stay offline; presigning keeps the real client's config. */
function stubSend(service: FileService, impl: SendImpl): void {
  const client = service['s3Client'];
  if (!client) throw new Error('S3 storage is not initialised');
  client.send = jest.fn(impl) as never;
}

function notFoundError(): Error & {
  name: string;
  $metadata: { httpStatusCode: number };
} {
  const err = new Error('not found') as Error & {
    name: string;
    $metadata: { httpStatusCode: number };
  };
  err.name = 'NotFound';
  err.$metadata = { httpStatusCode: 404 };
  return err;
}

/** HeadObject answers NotFound for scan/ keys (no overwrite), ok otherwise. */
function stubSendScanMissing(service: FileService): void {
  stubSend(service, async (cmd: unknown) => {
    if (
      cmd instanceof HeadObjectCommand &&
      String(cmd.input.Key ?? '').startsWith('scan/')
    ) {
      throw notFoundError();
    }
    return {};
  });
}

describe('FileService — S3_PUBLIC_ENDPOINT', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (s3Secrets.getSecret as jest.Mock).mockImplementation((k: string) =>
      k === 'S3_ACCESS_KEY_ID' ? 'AKIATEST' : 'test-secret',
    );
  });

  it('signs browser-facing URLs on the public endpoint', async () => {
    const { service } = await makeService({
      S3_PUBLIC_ENDPOINT: 'https://files.acme.test',
    });
    stubSendScanMissing(service);

    // The scan upload URL goes to the client's browser.
    const up = await service.uploadFile({
      scanId: S,
      projectId: P,
      typeScan: 'sast',
    });
    const upUrl = new URL(up.url);
    expect(upUrl.origin).toBe('https://files.acme.test');
    expect(upUrl.pathname).toMatch(/^\/b\/scan\//);

    // signObjectPut with audience 'browser' (the diff-scan upload URL).
    const browserOpts: {
      contentType: string;
      ttlSeconds: number;
      minBytes: number;
      maxBytes: number;
      audience?: 'browser' | 'internal';
    } = {
      contentType: 'application/zip',
      ttlSeconds: 60,
      minBytes: 0,
      maxBytes: 100,
      audience: 'browser',
    };
    const signed = await service.signObjectPut(
      `scan/${P}/${S}.zip`,
      browserOpts,
    );
    expect(new URL(signed.uploadUrl).origin).toBe('https://files.acme.test');

    // The report download URL goes to the dashboard's browser.
    const fin = await service.finalizeReportUpload({
      objectPath: `reports/${P}/${randomUUID()}.pdf`,
      projectId: P,
      ttlSeconds: 600,
      filename: 'report.pdf',
    });
    expect(new URL(fin.downloadUrl).origin).toBe('https://files.acme.test');
  });

  it('signs internal URLs on the internal endpoint', async () => {
    const repo = createMockRepository<FileScan>();
    repo.findOne.mockResolvedValue({
      scanId: S,
      objectPath: `scan/${P}/${S}.zip`,
    } as FileScan);
    const { service } = await makeService(
      { S3_PUBLIC_ENDPOINT: 'https://files.acme.test' },
      repo,
    );
    stubSend(service, async (cmd: unknown) => {
      if (cmd instanceof HeadObjectCommand) return { ContentLength: 2048 };
      return {};
    });

    // Scanner pods fetch the archive inside the network.
    const dl = await service.getDownloadUrl({ scanId: S });
    expect(new URL(dl.url).origin).toBe('http://minio:9000');

    // The import URLs stay internal: the gateway and analysis-reporting fetch
    // them inside the network.
    const imp = await service.requestImportUploadUrl({
      scanId: S,
      projectId: P,
      contentEncoding: 'gzip',
      contentLength: 1024,
    });
    expect(new URL(imp.uploadUrl).origin).toBe('http://minio:9000');
    const impDl = await service.getImportDownloadUrl({
      projectId: P,
      objectKey: `import/${P}/${S}.sarif`,
    });
    expect(new URL(impDl.url).origin).toBe('http://minio:9000');
  });

  it('uses the internal endpoint everywhere when no public endpoint is set', async () => {
    const repo = createMockRepository<FileScan>();
    repo.findOne.mockResolvedValue({
      scanId: S,
      objectPath: `scan/${P}/${S}.zip`,
    } as FileScan);
    const { service } = await makeService({}, repo);
    stubSendScanMissing(service);

    // No public endpoint: the presigner is the storage client itself.
    expect(service['s3PresignClient']).toBe(service['s3Client']);

    const up = await service.uploadFile({
      scanId: S,
      projectId: P,
      typeScan: 'sast',
    });
    expect(new URL(up.url).origin).toBe('http://minio:9000');

    const dl = await service.getDownloadUrl({ scanId: S });
    expect(new URL(dl.url).origin).toBe('http://minio:9000');

    const imp = await service.requestImportUploadUrl({
      scanId: S,
      projectId: P,
      contentEncoding: 'identity',
      contentLength: 512,
    });
    expect(new URL(imp.uploadUrl).origin).toBe('http://minio:9000');

    const impDl = await service.getImportDownloadUrl({
      projectId: P,
      objectKey: `import/${P}/${S}.sarif`,
    });
    expect(new URL(impDl.url).origin).toBe('http://minio:9000');

    const fin = await service.finalizeReportUpload({
      objectPath: `reports/${P}/${randomUUID()}.pdf`,
      projectId: P,
      ttlSeconds: 600,
      filename: 'report.pdf',
    });
    expect(new URL(fin.downloadUrl).origin).toBe('http://minio:9000');
  });
});

describe('FileService — getDownloadUrl audience (Community cluster scans)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (s3Secrets.getSecret as jest.Mock).mockImplementation((k: string) =>
      k === 'S3_ACCESS_KEY_ID' ? 'AKIATEST' : 'test-secret',
    );
  });

  function scanRepo(): ReturnType<typeof createMockRepository<FileScan>> {
    const repo = createMockRepository<FileScan>();
    repo.findOne.mockResolvedValue({
      scanId: S,
      objectPath: `scan/${P}/${S}.zip`,
    } as FileScan);
    return repo;
  }

  /** HeadObject misses every key but `hit`; records the keys it was asked. */
  function stubHeadHit(service: FileService, hit: string): string[] {
    const asked: string[] = [];
    stubSend(service, async (cmd: unknown) => {
      if (cmd instanceof HeadObjectCommand) {
        const key = String(cmd.input.Key ?? '');
        asked.push(key);
        if (key !== hit) throw notFoundError();
        return { ContentLength: 2048 };
      }
      return {};
    });
    return asked;
  }

  it('audience external signs on S3_PUBLIC_ENDPOINT, 20 min, on the filtered key', async () => {
    const { service } = await makeService(
      { S3_PUBLIC_ENDPOINT: 'https://files.acme.test' },
      scanRepo(),
    );
    const asked = stubHeadHit(service, `filtered/${P}/${S}.zip`);

    const dl = await service.getDownloadUrl({
      scanId: S,
      audience: 'external',
    });

    const url = new URL(dl.url);
    expect(url.origin).toBe('https://files.acme.test');
    expect(url.pathname).toBe(`/b/filtered/${P}/${S}.zip`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('1200');
    // The existence check still goes to the internal storage client.
    expect(asked).toEqual([`filtered/${P}/${S}.zip`]);
  });

  it('audience external keeps the candidate keys: filtered, legacy, raw', async () => {
    const { service } = await makeService(
      { S3_PUBLIC_ENDPOINT: 'https://files.acme.test' },
      scanRepo(),
    );
    const asked = stubHeadHit(service, `scan/${P}/${S}.zip`);

    const dl = await service.getDownloadUrl({
      scanId: S,
      audience: 'external',
    });

    expect(asked).toEqual([
      `filtered/${P}/${S}.zip`,
      `scan/${P}/${S}.filtered.zip`,
      `scan/${P}/${S}.zip`,
    ]);
    const url = new URL(dl.url);
    expect(url.origin).toBe('https://files.acme.test');
    expect(url.pathname).toBe(`/b/scan/${P}/${S}.zip`);
  });

  it('no audience: internal, as today', async () => {
    const { service } = await makeService(
      { S3_PUBLIC_ENDPOINT: 'https://files.acme.test' },
      scanRepo(),
    );
    stubHeadHit(service, `filtered/${P}/${S}.zip`);

    const dl = await service.getDownloadUrl({ scanId: S });

    const url = new URL(dl.url);
    expect(url.origin).toBe('http://minio:9000');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('1200');
  });

  it.each(['', 'internal', 'EXTERNAL', 'browser', 'external '])(
    'audience %j keeps the internal endpoint',
    async (audience) => {
      const { service } = await makeService(
        { S3_PUBLIC_ENDPOINT: 'https://files.acme.test' },
        scanRepo(),
      );
      stubHeadHit(service, `filtered/${P}/${S}.zip`);

      const dl = await service.getDownloadUrl({ scanId: S, audience });

      expect(new URL(dl.url).origin).toBe('http://minio:9000');
    },
  );

  it('audience external without a public endpoint signs on the storage endpoint', async () => {
    const { service } = await makeService({}, scanRepo());
    stubHeadHit(service, `filtered/${P}/${S}.zip`);

    const dl = await service.getDownloadUrl({
      scanId: S,
      audience: 'external',
    });

    expect(new URL(dl.url).origin).toBe('http://minio:9000');
  });
});

describe('validationSchema — S3_PUBLIC_ENDPOINT', () => {
  const base = {
    GRPC_URL_SECURITY_SCANNING_SERVICE: 'localhost:50053',
    STORAGE_PROVIDER: 's3',
    S3_BUCKET_NAME: 'b',
    S3_ENDPOINT: 'http://minio:9000',
    AWS_REGION: 'eu-west-1',
    OTEL_DISABLED: 'true',
  };

  it('rejects an S3_PUBLIC_ENDPOINT that is not a URI', () => {
    const { error } = validationSchema.validate({
      ...base,
      S3_PUBLIC_ENDPOINT: 'x',
    });
    expect(error?.message).toBe('"S3_PUBLIC_ENDPOINT" must be a valid uri');
  });

  it('accepts a URI and keeps the key optional', () => {
    expect(validationSchema.validate(base).error).toBeUndefined();
    const ok = validationSchema.validate({
      ...base,
      S3_PUBLIC_ENDPOINT: 'https://files.acme.test',
    });
    expect(ok.error).toBeUndefined();
    expect(ok.value.S3_PUBLIC_ENDPOINT).toBe('https://files.acme.test');
  });
});
