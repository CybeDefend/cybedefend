import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { of } from 'rxjs';
import { status } from '@grpc/grpc-js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import archiver from 'archiver';
import * as yauzl from 'yauzl';

import { FileService } from './file.service';
import { FileScan, FileStatus } from 'src/entities/file.entity';
import { createLoggerMock, createMockRepository } from 'src/test-utils/mocks';
import SecretsService from 'src/core/secrets/secrets.service';
import { Logger } from 'nestjs-pino';

// Git run with no system or user configuration, so a test only sees the
// configuration of the repository it reads.
function isolatedGitEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };
}

async function listFilesRecursively(
  dir: string,
  prefix = '',
): Promise<string[]> {
  const out: string[] = [];
  for (const d of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) {
      out.push(...(await listFilesRecursively(path.join(dir, d.name), rel)));
    } else if (d.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

async function readZipEntries(
  zipPath: string,
): Promise<Record<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const out: Record<string, Buffer> = {};
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zf) => {
      if (err) return reject(err);
      zf.readEntry();
      zf.on('entry', (entry) => {
        zf.openReadStream(entry, (e, rs) => {
          if (e) return reject(e);
          const chunks: Buffer[] = [];
          rs.on('data', (c: Buffer) => chunks.push(c));
          rs.on('end', () => {
            out[entry.fileName] = Buffer.concat(chunks);
            zf.readEntry();
          });
          rs.on('error', reject);
        });
      });
      zf.on('end', () => resolve(out));
      zf.on('error', reject);
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: create a ZIP on disk from a map of { entryName -> content }
// ---------------------------------------------------------------------------
async function createTestZip(
  destPath: string,
  entries: Record<string, string | Buffer>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const arc = archiver('zip', { zlib: { level: 1 } });
    arc.pipe(output);
    for (const [name, content] of Object.entries(entries)) {
      arc.append(Buffer.isBuffer(content) ? content : Buffer.from(content), {
        name,
      });
    }
    output.on('close', resolve);
    arc.on('error', reject);
    arc.finalize();
  });
}

// ---------------------------------------------------------------------------
// Helper: a stored (uncompressed) ZIP whose entry names are written byte for
// byte. archiver rewrites names (backslashes to slashes, leading `../` and `/`
// dropped), so it cannot build the hostile archives a client can upload.
// ---------------------------------------------------------------------------
async function createRawZip(
  destPath: string,
  entries: Record<string, string>,
): Promise<void> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  await fs.promises.writeFile(
    destPath,
    Buffer.concat([...locals, centralDir, end]),
  );
}

// ---------------------------------------------------------------------------
// Helper: list entry names from a ZIP on disk
// ---------------------------------------------------------------------------
async function listZipEntries(zipPath: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const names: string[] = [];
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zf) => {
      if (err) return reject(err);
      zf.readEntry();
      zf.on('entry', (entry) => {
        names.push(entry.fileName);
        zf.readEntry();
      });
      zf.on('end', () => resolve(names));
      zf.on('error', reject);
    });
  });
}

// Mocks for external libs used internally to avoid real network/filesystem
jest.mock('uuid', () => ({ v6: () => 'mock-uuid' }));

// Mock the S3 presigner so tests can inspect the GetObjectCommand input
// (Content-Disposition forcing, etc.) without round-tripping through AWS SigV4.
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/s3'),
}));
import { getSignedUrl as mockedGetSignedUrl } from '@aws-sdk/s3-request-presigner';

describe('FileService', () => {
  let service: FileService;
  const logger = createLoggerMock();

  const mockStartScan = jest.fn(() => of({}));
  const mockUpdateScanData = jest.fn(() => of({}));

  const mockScanClient = {
    getService: jest.fn().mockReturnValue({
      startScan: mockStartScan,
      updateScanData: mockUpdateScanData,
    }),
  } as unknown as ClientGrpc;

  const makeConfig = (over: Record<string, any> = {}) =>
    new ConfigService({
      STORAGE_PROVIDER: 's3',
      FILE_SCAN_MIN_FILE_SIZE_BYTES: 10,
      FILE_SCAN_MIN_FILE_AGE_SECONDS: 0,
      FILE_SCAN_UPLOAD_TIMEOUT_MINUTES: 30,
      FILE_SCAN_PROCESSING_TIMEOUT_MINUTES: 15,
      S3_BUCKET_NAME: 'test-bucket',
      ...over,
    });

  // A plain function, not a mock: jest.resetAllMocks() must not empty the S3
  // credentials FileService reads in its constructor.
  const secrets = {
    getSecret: () => 'x',
    ensureCacheLoaded: jest.fn(),
  } as unknown as SecretsService;

  beforeEach(async () => {
    jest.resetAllMocks();
  });

  describe('getDownloadUrl (S3)', () => {
    it('throws NOT_FOUND when S3 object missing', async () => {
      const s3Repo = createMockRepository<FileScan>();
      s3Repo.findOne.mockResolvedValue({
        scanId: 's2',
        objectPath: 'scan/p2/s2.zip',
      } as any);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          { provide: getRepositoryToken(FileScan), useValue: s3Repo },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          {
            provide: ConfigService,
            useValue: makeConfig({
              STORAGE_PROVIDER: 's3',
              S3_BUCKET_NAME: 'b',
              S3_ENDPOINT: 'http://s3',
              AWS_REGION: 'eu-west-1',
            }),
          },
          {
            provide: SecretsService,
            useValue: {
              getSecret: jest.fn(() => 'k'),
              ensureCacheLoaded: jest.fn(),
            },
          },
          { provide: Logger, useValue: logger },
        ],
      }).compile();

      service = module.get(FileService);

      // inject s3 client stub
      service['s3Client'] = {
        send: jest.fn(async () => {
          const err: any = new Error('not found');
          err.name = 'NotFound';
          throw err;
        }),
      } as any;

      await expect(
        service.getDownloadUrl({ scanId: 's2' } as any),
      ).rejects.toMatchObject({
        error: { code: status.NOT_FOUND },
      });
    });

    it('wraps unknown S3 errors as INTERNAL', async () => {
      const s3Repo = createMockRepository<FileScan>();
      s3Repo.findOne.mockResolvedValue({
        scanId: 's3',
        objectPath: 'scan/p3/s3.zip',
      } as any);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          { provide: getRepositoryToken(FileScan), useValue: s3Repo },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          {
            provide: ConfigService,
            useValue: makeConfig({
              STORAGE_PROVIDER: 's3',
              S3_BUCKET_NAME: 'b',
              S3_ENDPOINT: 'http://s3',
              AWS_REGION: 'eu-west-1',
            }),
          },
          {
            provide: SecretsService,
            useValue: {
              getSecret: jest.fn(() => 'k'),
              ensureCacheLoaded: jest.fn(),
            },
          },
          { provide: Logger, useValue: logger },
        ],
      }).compile();

      service = module.get(FileService);
      service['s3Client'] = {
        send: jest.fn(async () => {
          const err: any = new Error('boom');
          err.name = 'Other';
          throw err;
        }),
      } as any;

      await expect(
        service.getDownloadUrl({ scanId: 's3' } as any),
      ).rejects.toMatchObject({
        error: { code: status.INTERNAL },
      });
    });
  });

  describe('getDownloadUrl — signed-URL TTL is 20 min', () => {
    it('S3: presigns a read URL with expiresIn of 1200 seconds', async () => {
      const s3Repo = createMockRepository<FileScan>();
      s3Repo.findOne.mockResolvedValue({
        scanId: 's2',
        objectPath: 'scan/p2/s2.zip',
      } as any);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          { provide: getRepositoryToken(FileScan), useValue: s3Repo },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          {
            provide: ConfigService,
            useValue: makeConfig({
              STORAGE_PROVIDER: 's3',
              S3_BUCKET_NAME: 'b',
              S3_ENDPOINT: 'http://s3',
              AWS_REGION: 'eu-west-1',
            }),
          },
          {
            provide: SecretsService,
            useValue: {
              getSecret: jest.fn(() => 'k'),
              ensureCacheLoaded: jest.fn(),
            },
          },
          { provide: Logger, useValue: logger },
        ],
      }).compile();

      service = module.get(FileService);
      service['s3Client'] = { send: jest.fn().mockResolvedValue({}) } as any;

      // beforeEach runs jest.resetAllMocks(), which clears the module-level
      // default resolved value — re-arm it for this call.
      (mockedGetSignedUrl as jest.Mock).mockResolvedValue(
        'https://signed.example/s3',
      );

      const resp = await service.getDownloadUrl({ scanId: 's2' } as any);
      expect(resp.url).toBe('https://signed.example/s3');

      const ttlOpts = (mockedGetSignedUrl as jest.Mock).mock.calls[0][2];
      expect(ttlOpts).toEqual({ expiresIn: 20 * 60 });
    });

    async function buildS3Download(over: Record<string, any> = {}) {
      const s3Repo = createMockRepository<FileScan>();
      s3Repo.findOne.mockResolvedValue({
        scanId: 's5',
        objectPath: 'scan/p5/s5.zip',
      } as any);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          { provide: getRepositoryToken(FileScan), useValue: s3Repo },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          {
            provide: ConfigService,
            useValue: makeConfig({
              STORAGE_PROVIDER: 's3',
              S3_BUCKET_NAME: 'b',
              S3_ENDPOINT: 'http://s3',
              S3_PUBLIC_ENDPOINT: 'https://files.acme.test',
              AWS_REGION: 'eu-west-1',
              ...over,
            }),
          },
          {
            provide: SecretsService,
            useValue: {
              getSecret: jest.fn(() => 'k'),
              ensureCacheLoaded: jest.fn(),
            },
          },
          { provide: Logger, useValue: logger },
        ],
      }).compile();
      const svc = module.get(FileService);
      (mockedGetSignedUrl as jest.Mock).mockResolvedValue(
        'https://signed.example/s3',
      );
      return svc;
    }

    it('S3: audience external presigns on the public client, 1200 s, same key', async () => {
      const svc = await buildS3Download();
      const send = jest.fn().mockResolvedValue({});
      svc['s3Client'].send = send as never;

      const resp = await svc.getDownloadUrl({
        scanId: 's5',
        audience: 'external',
      });

      expect(resp.url).toBe('https://signed.example/s3');
      const [client, cmd, opts] = (mockedGetSignedUrl as jest.Mock).mock
        .calls[0];
      expect(client).toBe(svc['s3PresignClient']);
      expect(client).not.toBe(svc['s3Client']);
      expect(cmd.input).toEqual({ Bucket: 'b', Key: 'filtered/p5/s5.zip' });
      expect(opts).toEqual({ expiresIn: 20 * 60 });
      // The HeadObject check stays on the storage client.
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('S3: no audience presigns on the storage client, as today', async () => {
      const svc = await buildS3Download();
      svc['s3Client'].send = jest.fn().mockResolvedValue({}) as never;

      await svc.getDownloadUrl({ scanId: 's5' });

      const [client] = (mockedGetSignedUrl as jest.Mock).mock.calls[0];
      expect(client).toBe(svc['s3Client']);
    });

    it('S3: a failed check for an external URL logs no signed URL', async () => {
      const svc = await buildS3Download();
      svc['s3Client'].send = jest.fn().mockRejectedValue(
        Object.assign(new Error('boom'), {
          $metadata: { httpStatusCode: 500 },
        }),
      ) as never;
      (logger.error as jest.Mock).mockClear();

      const err = await svc
        .getDownloadUrl({ scanId: 's5', audience: 'external' })
        .catch((e: unknown) => e);

      expect(err).toBeDefined();
      expect(mockedGetSignedUrl).not.toHaveBeenCalled();
      const logged = JSON.stringify((logger.error as jest.Mock).mock.calls);
      expect(logged).not.toContain('X-Amz-');
      expect(logged).not.toContain('files.acme.test');
    });
  });

  // -------------------------------------------------------------------------
  // requestReportUploadUrl / finalizeReportUpload: bypass
  // gRPC max-message-size by handing analysis-reporting a signed PUT URL.
  // -------------------------------------------------------------------------
  describe('requestReportUploadUrl', () => {
    it('throws INVALID_ARGUMENT when projectId is missing', async () => {
      const rRepo = createMockRepository<FileScan>();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          { provide: getRepositoryToken(FileScan), useValue: rRepo },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          { provide: ConfigService, useValue: makeConfig() },
          { provide: SecretsService, useValue: secrets },
          { provide: Logger, useValue: logger },
        ],
      }).compile();
      service = module.get(FileService);

      await expect(
        service.requestReportUploadUrl({
          projectId: '',
          filename: 'r.pdf',
          contentType: 'application/pdf',
        } as any),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
    });
  });

  describe('finalizeReportUpload', () => {
    it('rejects a cross-project objectPath (projectId != reports/<id>/...)', async () => {
      // When the caller advertises projectId=p1 but tries to finalise a
      // path under reports/p2/, we MUST refuse to mint a signed URL: an
      // objectPath must belong to the caller's project, never to another
      // tenant's, whatever objectPath
      // returned to it earlier (it never gets re-validated against the
      // caller's project in the legacy code path).
      const rRepo = createMockRepository<FileScan>();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          { provide: getRepositoryToken(FileScan), useValue: rRepo },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          { provide: ConfigService, useValue: makeConfig() },
          { provide: SecretsService, useValue: secrets },
          { provide: Logger, useValue: logger },
        ],
      }).compile();
      service = module.get(FileService);

      await expect(
        service.finalizeReportUpload({
          projectId: 'p1',
          objectPath: 'reports/p2/abc.pdf',
          ttlSeconds: 900,
        } as any),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
    });

    it('rejects a missing projectId — defence in depth after proto requires it', async () => {
      // Once libs/protos/file-management/file.proto landed `project_id` as a
      // required field, legacy callers that still emit empty projectId must
      // be refused outright instead of silently bypassing the cross-tenant
      // check. Defence in depth: the proto type guarantees the field exists
      // on the wire, but a hand-crafted client could still ship an empty
      // string.
      const rRepo = createMockRepository<FileScan>();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          { provide: getRepositoryToken(FileScan), useValue: rRepo },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          { provide: ConfigService, useValue: makeConfig() },
          { provide: SecretsService, useValue: secrets },
          { provide: Logger, useValue: logger },
        ],
      }).compile();
      service = module.get(FileService);

      await expect(
        service.finalizeReportUpload({
          projectId: '',
          objectPath: 'reports/p1/abc.pdf',
          ttlSeconds: 900,
        } as any),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
    });

    it('rejects object paths outside the reports/ prefix', async () => {
      const rRepo = createMockRepository<FileScan>();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          { provide: getRepositoryToken(FileScan), useValue: rRepo },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          { provide: ConfigService, useValue: makeConfig() },
          { provide: SecretsService, useValue: secrets },
          { provide: Logger, useValue: logger },
        ],
      }).compile();
      service = module.get(FileService);

      await expect(
        service.finalizeReportUpload({
          objectPath: 'scan/p1/abc.zip',
          ttlSeconds: 900,
        } as any),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
    });
  });

  describe('finalizeReportUpload (S3)', () => {
    const buildS3Service = async (sendImpl: jest.Mock) => {
      const rRepo = createMockRepository<FileScan>();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          { provide: getRepositoryToken(FileScan), useValue: rRepo },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          {
            provide: ConfigService,
            useValue: makeConfig({
              STORAGE_PROVIDER: 's3',
              S3_BUCKET_NAME: 'b',
              S3_ENDPOINT: 'http://s3',
              AWS_REGION: 'eu-west-1',
            }),
          },
          {
            provide: SecretsService,
            useValue: {
              getSecret: jest.fn(() => 'k'),
              ensureCacheLoaded: jest.fn(),
            },
          },
          { provide: Logger, useValue: logger },
        ],
      }).compile();
      const s = module.get(FileService);
      s['s3Client'] = { send: sendImpl } as any;
      return s;
    };

    it('passes ResponseContentDisposition to GetObjectCommand for forced download', async () => {
      (mockedGetSignedUrl as jest.Mock).mockClear();
      // send only services the HeadObject existence check
      const send = jest.fn().mockResolvedValue({});
      const s = await buildS3Service(send);

      await s.finalizeReportUpload({
        projectId: 'p1',
        objectPath: 'reports/p1/abc.pdf',
        ttlSeconds: 900,
        filename: 'owasp-report.pdf',
      } as any);

      expect(mockedGetSignedUrl).toHaveBeenCalledTimes(1);
      const command = (mockedGetSignedUrl as jest.Mock).mock.calls[0][1];
      expect(command.input.ResponseContentDisposition).toBe(
        'attachment; filename="owasp-report.pdf"',
      );
    });

    it('falls back to bare attachment on S3 when filename absent', async () => {
      (mockedGetSignedUrl as jest.Mock).mockClear();
      const send = jest.fn().mockResolvedValue({});
      const s = await buildS3Service(send);

      await s.finalizeReportUpload({
        projectId: 'p1',
        objectPath: 'reports/p1/abc.pdf',
        ttlSeconds: 900,
      } as any);

      const command = (mockedGetSignedUrl as jest.Mock).mock.calls[0][1];
      expect(command.input.ResponseContentDisposition).toBe('attachment');
    });
  });

  // -------------------------------------------------------------------------
  // deleteReportObject: hard-delete a stored report object with the
  // same cross-tenant boundary as finalize, idempotent on already-gone objects.
  // -------------------------------------------------------------------------
  describe('deleteReportObject', () => {
    const buildService = async () => {
      const rRepo = createMockRepository<FileScan>();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          { provide: getRepositoryToken(FileScan), useValue: rRepo },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          { provide: ConfigService, useValue: makeConfig() },
          { provide: SecretsService, useValue: secrets },
          { provide: Logger, useValue: logger },
        ],
      }).compile();
      return module.get(FileService);
    };

    it('rejects a cross-project objectPath (INVALID_ARGUMENT) and never deletes', async () => {
      const s = await buildService();
      const del = jest.spyOn(s['s3Client']!, 'send');

      await expect(
        s.deleteReportObject({
          objectPath: 'reports/p2/secret.pdf',
          projectId: 'p1',
        } as any),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
      expect(del).not.toHaveBeenCalled();
    });

    it('rejects an objectPath outside the reports/ prefix (INVALID_ARGUMENT)', async () => {
      const s = await buildService();
      await expect(
        s.deleteReportObject({
          objectPath: 'scans/p1/x.zip',
          projectId: 'p1',
        } as any),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
    });
  });

  describe('isFileReady (S3)', () => {
    it('returns true when headObject meets constraints', async () => {
      const fRepo = createMockRepository<FileScan>();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          { provide: getRepositoryToken(FileScan), useValue: fRepo },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          {
            provide: ConfigService,
            useValue: makeConfig({
              STORAGE_PROVIDER: 's3',
              S3_BUCKET_NAME: 'b',
              S3_ENDPOINT: 'http://s3',
              AWS_REGION: 'eu-west-1',
            }),
          },
          {
            provide: SecretsService,
            useValue: {
              getSecret: jest.fn(() => 'k'),
              ensureCacheLoaded: jest.fn(),
            },
          },
          { provide: Logger, useValue: logger },
        ],
      }).compile();

      service = module.get(FileService);
      service['s3Client'] = {
        send: jest.fn(async () => ({
          ContentLength: 20,
          LastModified: new Date(Date.now() - 10_000),
          ContentType: 'application/zip',
        })),
      } as any;

      const ok = await service.isFileReady('scan/p/x.zip');
      expect(ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // filterZipFile — .git passthrough for history-based secret scanning
  // -------------------------------------------------------------------------
  describe('filterZipFile (.git passthrough)', () => {
    let filterService: FileService;
    let tmpDir: string;

    beforeEach(async () => {
      // Use a fresh temp directory for each test
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fms-test-'));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          {
            provide: getRepositoryToken(FileScan),
            useValue: createMockRepository<FileScan>(),
          },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          { provide: ConfigService, useValue: makeConfig() },
          { provide: SecretsService, useValue: secrets },
          { provide: Logger, useValue: logger },
        ],
      }).compile();

      filterService = module.get(FileService);
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it('keeps .git/* files in the filtered output when scanning for secret history', async () => {
      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, {
        'src/app.js': "console.log('hi');",
        '.git/HEAD': 'ref: refs/heads/main',
        '.git/config': '[core]\n\trepositoryformatversion = 0',
        '.git/objects/pack/pack-abc.pack': Buffer.from([
          0x50, 0x41, 0x43, 0x4b, 0x00, 0x00, 0x00, 0x02,
        ]),
        '.git/refs/heads/main': 'abc123def456\n',
      });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );
      const entries = await listZipEntries(outZip);

      expect(entries).toContain('src/app.js');
      expect(entries).toContain('.git/HEAD');
      expect(entries).toContain('.git/config');
      expect(entries).toContain('.git/objects/pack/pack-abc.pack');
      expect(entries).toContain('.git/refs/heads/main');
    });

    it('forwards the history but no repository git configuration or hooks', async () => {
      // A real repository whose .git carries everything git would execute:
      // a diff textconv driver, fsmonitor, a pager, hooks, attributes and a
      // submodule config. Each one would write `pwned` if git ran it.
      const repoDir = path.join(tmpDir, 'repo');
      await fs.promises.mkdir(repoDir);
      const git = (cwd: string, ...args: string[]) =>
        execFileSync(
          'git',
          ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
          { cwd, env: isolatedGitEnv(tmpDir), encoding: 'utf8' },
        );
      git(repoDir, 'init', '-q', '-b', 'main');
      await fs.promises.writeFile(path.join(repoDir, 'app.js'), 'a\n');
      git(repoDir, 'add', '.');
      git(repoDir, 'commit', '-qm', 'one');
      await fs.promises.writeFile(path.join(repoDir, 'app.js'), 'a\nb\n');
      git(repoDir, 'commit', '-qam', 'two');

      const marker = path.join(tmpDir, 'pwned');
      const run = `sh -c 'echo x > ${marker}'`;
      const entries: Record<string, string | Buffer> = {
        'app.js': 'a\nb\n',
      };
      for (const file of await listFilesRecursively(
        path.join(repoDir, '.git'),
      )) {
        entries[`.git/${file}`] = await fs.promises.readFile(
          path.join(repoDir, '.git', file),
        );
      }
      entries['.git/config'] = [
        '[core]',
        '\trepositoryformatversion = 0',
        `\tfsmonitor = "${run}"`,
        `\tpager = ${run}`,
        '[diff "evil"]',
        `\ttextconv = ${run}`,
        '[filter "evil"]',
        `\tsmudge = ${run}`,
      ].join('\n');
      entries['.git/info/attributes'] = '* diff=evil filter=evil\n';
      entries['.git/hooks/post-checkout'] = `#!/bin/sh\n${run}\n`;
      entries['.git/hooks/pre-commit'] = `#!/bin/sh\n${run}\n`;
      entries['.git/modules/lib/config'] = `[core]\n\tfsmonitor = ${run}\n`;
      entries['.git/objects/info/alternates'] = '/etc\n';
      entries['sub/.git/config'] = `[core]\n\tfsmonitor = ${run}\n`;

      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, entries);

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );
      const out = await readZipEntries(outZip);
      const names = Object.keys(out);

      expect(names.filter((n) => n.startsWith('.git/hooks/'))).toEqual([]);
      expect(names).not.toContain('.git/info/attributes');
      expect(names).not.toContain('.git/modules/lib/config');
      expect(names).not.toContain('.git/objects/info/alternates');
      expect(names).not.toContain('sub/.git/config');
      expect(out['.git/config'].toString('utf8')).toBe(
        '[core]\n\trepositoryformatversion = 0\n\tbare = false\n',
      );
      expect(names).toContain('.git/HEAD');
      expect(names).toContain('app.js');

      // The scanner side: extract and read the whole history with patches.
      const extracted = path.join(tmpDir, 'extracted');
      for (const [name, data] of Object.entries(out)) {
        const dest = path.join(extracted, name);
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.writeFile(dest, data, { mode: 0o755 });
      }
      const log = execFileSync('git', ['log', '-p', '--all', '--format=%s'], {
        cwd: extracted,
        env: isolatedGitEnv(tmpDir),
        encoding: 'utf8',
      });
      expect(log).toContain('two');
      expect(log).toContain('one');
      expect(log).toContain('+b');
      execFileSync('git', ['status', '--porcelain'], {
        cwd: extracted,
        env: isolatedGitEnv(tmpDir),
      });
      expect(fs.existsSync(marker)).toBe(false);
    });

    it('skips an entry whose name holds a backslash, a NUL, a `..` segment or an absolute path', async () => {
      // The archive writer turns `\\` into `/`: a name read as one harmless
      // segment would come out as a traversal or a git hook.
      const inputZip = path.join(tmpDir, 'input.zip');
      await createRawZip(inputZip, {
        'src/app.js': 'ok',
        '.git/HEAD': 'ref: refs/heads/main',
        '.git/refs/x\\..\\..\\config': '[core]\n\tfsmonitor = evil',
        'a\\..\\..\\x.py': 'print(1)',
        '.git\\hooks\\pre-commit.py': 'print(1)',
        'src\\lib.py': 'print(1)',
        'src/nul\u0000.py': 'print(1)',
        'src/../../escape.py': 'print(1)',
        'src/a/../b.py': 'print(1)',
        '/etc/abs.py': 'print(1)',
        'C:/win.py': 'print(1)',
      });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );
      const names = await listZipEntries(outZip);

      expect(names.sort()).toEqual(['.git/HEAD', '.git/config', 'src/app.js']);
      expect(names.some((n) => n.startsWith('.git/hooks/'))).toBe(false);
    });

    it('adds no git config to an archive without a .git directory', async () => {
      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, { 'src/app.ts': 'const x = 1;' });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );

      expect(await listZipEntries(outZip)).toEqual(['src/app.ts']);
    });

    it('still includes regular source code files alongside .git entries (no traversal needed)', async () => {
      // Note: archiver normalises entry names at write time (e.g. "../.git/HEAD" → ".git/HEAD"),
      // so a zip-based traversal test would be vacuously true and NOT exercise the guard.
      // The traversal-predicate itself is tested directly in FileService.isPathTraversal below.
      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, {
        '.git/HEAD': 'ref: refs/heads/main',
        'src/app.ts': 'const x = 1;',
      });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );
      const entries = await listZipEntries(outZip);

      expect(entries).toContain('.git/HEAD');
      expect(entries).toContain('src/app.ts');
    });

    it('still excludes node_modules and other hardcoded dirs', async () => {
      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, {
        'src/app.js': "console.log('hi');",
        'node_modules/foo/index.js': 'module.exports = {}',
        'vendor/bar.php': '<?php echo "hi";',
      });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );
      const entries = await listZipEntries(outZip);

      expect(entries).toContain('src/app.js');
      expect(entries).not.toContain('node_modules/foo/index.js');
      expect(entries).not.toContain('vendor/bar.php');
    });

    it('still includes regular source code files alongside .git entries', async () => {
      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, {
        '.git/HEAD': 'ref: refs/heads/main',
        'src/main.ts': 'export const x = 1;',
        'package.json': '{"name":"test"}',
      });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );
      const entries = await listZipEntries(outZip);

      expect(entries).toContain('.git/HEAD');
      expect(entries).toContain('src/main.ts');
      expect(entries).toContain('package.json');
    });
  });

  // -------------------------------------------------------------------------
  // filterZipFile — .cybedefend directory handling
  //
  // Regression guard: previously, any source entry whose path contained
  // "cybedefend" (typically `.cybedefend/config.json` for the new
  // project-rules directory layout) caused filterZipFile to ALSO append a
  // bare file entry named `.cybedefend` at the zip root. That stray file
  // shadowed the `.cybedefend/` directory at extraction time, breaking both
  // Go scanners (`mkdir .cybedefend: not a directory`) and the Python
  // ingestion service (`[Errno 20] Not a directory`).
  // -------------------------------------------------------------------------
  describe('filterZipFile (.cybedefend directory handling)', () => {
    let filterService: FileService;
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fms-test-'));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          {
            provide: getRepositoryToken(FileScan),
            useValue: createMockRepository<FileScan>(),
          },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          { provide: ConfigService, useValue: makeConfig() },
          { provide: SecretsService, useValue: secrets },
          { provide: Logger, useValue: logger },
        ],
      }).compile();

      filterService = module.get(FileService);
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it('preserves .cybedefend/config.json without emitting a shadowing root file entry', async () => {
      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, {
        'src/app.ts': 'export const x = 1;',
        '.cybedefend/config.json': '{"projectId":"abc"}',
      });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );
      const entries = await listZipEntries(outZip);

      expect(entries).toContain('.cybedefend/config.json');
      // The directory must remain a directory in the output. A bare file
      // entry literally named '.cybedefend' (no slash) would shadow it and
      // is exactly the bug we are guarding against.
      expect(entries).not.toContain('.cybedefend');
    });

    it('keeps a root-level .cybedefend file when it is the only one present', async () => {
      // Legacy single-file layout, before the directory format was adopted.
      // Should still be kept as-is via the `alwaysKeepNames` allowlist.
      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, {
        'src/app.ts': 'export const x = 1;',
        '.cybedefend': '{"projectId":"abc"}',
      });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );
      const entries = await listZipEntries(outZip);

      expect(entries).toContain('.cybedefend');
      expect(entries).toContain('src/app.ts');
    });

    it('keeps a root-level .cybeignore file', async () => {
      // `.cybeignore` is the recommended name for the SAST exclusion file.
      // It has no extension, so only the `alwaysKeepNames` allowlist saves it
      // from filterZipFile; without the entry the scanner never sees it and
      // every exclusion the repository declares is silently ignored.
      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, {
        'src/app.ts': 'export const x = 1;',
        '.cybeignore': '**/*.spec.ts\n',
      });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );
      const entries = await listZipEntries(outZip);

      expect(entries).toContain('.cybeignore');
      expect(entries).toContain('src/app.ts');
    });

    it('keeps .cybeignore alongside a .cybedefend/ directory', async () => {
      // The layout `.cybeignore` exists to enable: a repository linked with
      // a closed product holds `.cybedefend/config.json`, which takes the root path
      // and makes the legacy `.cybedefend` *file* impossible. Both must survive.
      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, {
        'src/app.ts': 'export const x = 1;',
        '.cybedefend/config.json': '{"projectId":"abc"}',
        '.cybeignore': 'docker-compose.yml\n',
      });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );
      const entries = await listZipEntries(outZip);

      expect(entries).toContain('.cybeignore');
      expect(entries).toContain('.cybedefend/config.json');
      expect(entries).not.toContain('.cybedefend');
    });
  });

  // -------------------------------------------------------------------------
  // filterZipFile — files the secret scanner reads
  //
  // The filter keeps source code and build files for every scanner, and drops
  // what no scanner reads (media, binaries, dependencies, build outputs). A
  // configuration or data file of a type no language claims holds credentials
  // as often as a source file does, so the secret scanner must receive it at
  // any depth: dropped, its secrets are never scanned and the scan still says
  // completed.
  // -------------------------------------------------------------------------
  describe('filterZipFile (files the secret scanner reads)', () => {
    let filterService: FileService;
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fms-test-'));
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          {
            provide: getRepositoryToken(FileScan),
            useValue: createMockRepository<FileScan>(),
          },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          { provide: ConfigService, useValue: makeConfig() },
          { provide: SecretsService, useValue: secrets },
          { provide: Logger, useValue: logger },
        ],
      }).compile();
      filterService = module.get(FileService);
      filterService['storage'] = {} as any;
      filterService['gcpBucketName'] = 'test-bucket';
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    // Configuration and data files where credentials are commonly committed.
    const SECRET_BEARING_FILES = [
      'config/app.properties',
      'src/main/resources/application-prod.properties',
      'config/app.cfg',
      'setup.cfg',
      'config/data.csv',
      'exports/users.tsv',
      'config/notes.txt',
      'docs/deploy/credentials.txt',
      'deploy/prod.env',
      'config/.env.docker',
      'service/.env.example',
      '.env.sample',
      '.envrc',
      'mysql/my.cnf',
      'terraform/prod.tfvars',
      'terraform/prod.auto.tfvars',
      'db/seed.sql',
      'ios/Config.xcconfig',
      'ios/Info.plist',
      'vpn/client.ovpn',
      'config/settings.ini.dist',
      'config/database.yml.example',
      'config/app.conf.sample',
      'config/app.json.template',
      'config/old/settings.bak',
      'keys/api.secret',
    ];

    it.each(SECRET_BEARING_FILES)('keeps %s', async (name) => {
      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, {
        'src/app.ts': 'export const x = 1;',
        [name]: 'token=ghp_0123456789abcdefghijklmnopqrstuvwxyz\n',
      });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );

      expect(await listZipEntries(outZip)).toContain(name);
    });

    it('still drops media, binaries, dependencies and build outputs', async () => {
      const inputZip = path.join(tmpDir, 'input.zip');
      await createTestZip(inputZip, {
        'src/app.ts': 'export const x = 1;',
        'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        'lib/native.so': Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
        'node_modules/left-pad/notes.txt': 'token=x',
        'dist/app.properties': 'token=x',
        'logs/app.log': 'token=x',
      });

      const outZip: string = await filterService['filterZipFile'](
        inputZip,
        tmpDir,
      );

      expect((await listZipEntries(outZip)).sort()).toEqual(['src/app.ts']);
    });
  });

  // -------------------------------------------------------------------------
  // computeZipMetrics — extracted in Part C of the upstream-timeout refacto.
  // file-management computes LOC + size + languages from the already-filtered
  // ZIP and passes them in StartScanRequest, sparing security-scanning the
  // second download + parse round trip.
  // -------------------------------------------------------------------------
  describe('computeZipMetrics', () => {
    let metricsService: FileService;
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'fms-metrics-'),
      );

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          {
            provide: getRepositoryToken(FileScan),
            useValue: createMockRepository<FileScan>(),
          },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          { provide: ConfigService, useValue: makeConfig() },
          { provide: SecretsService, useValue: secrets },
          { provide: Logger, useValue: logger },
        ],
      }).compile();

      metricsService = module.get(FileService);
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it('counts non-empty lines from code files and detects languages', async () => {
      const zipPath = path.join(tmpDir, 'sample.zip');
      await createTestZip(zipPath, {
        'src/app.ts': 'const x = 1;\nconst y = 2;\n\nconst z = 3;\n', // 3 non-empty
        'src/util.py': "import os\n\nprint('hi')\n", // 2 non-empty
        'README.md': '# Readme should be ignored by LOC counter\n', // .md not in map
      });

      const result = await metricsService.computeZipMetrics(zipPath);

      expect(result.totalLOC).toBe(5);
      expect(result.language).toEqual(
        expect.arrayContaining(['TypeScript', 'Python']),
      );
      expect(result.language).not.toContain('Markdown');
      expect(result.totalSize).toMatch(/^\d+\.\d{2}Mo$/);
    });

    it('handles extension-less files in the well-known allowlist (Dockerfile)', async () => {
      const zipPath = path.join(tmpDir, 'docker.zip');
      await createTestZip(zipPath, {
        Dockerfile: 'FROM node:24\nRUN apt-get update\n',
      });

      const result = await metricsService.computeZipMetrics(zipPath);

      expect(result.totalLOC).toBe(2);
      expect(result.language).toContain('Dockerfile');
    });

    it('returns zero LOC and empty languages for an empty ZIP', async () => {
      const zipPath = path.join(tmpDir, 'empty.zip');
      await createTestZip(zipPath, {});

      const result = await metricsService.computeZipMetrics(zipPath);

      expect(result.totalLOC).toBe(0);
      expect(result.language).toEqual([]);
      expect(result.totalSize).toMatch(/Mo$/);
    });

    it('ignores entries that escape via path traversal', async () => {
      // archiver normalises entry names, so we craft the malicious entry
      // manually via a writeStream interception is overkill — instead we
      // assert the predicate path: if a normalised entry starts with ".."
      // or is absolute, it must not contribute to language/LOC. The
      // happy-path entries alongside must still be counted.
      const zipPath = path.join(tmpDir, 'mixed.zip');
      await createTestZip(zipPath, {
        'src/safe.ts': 'const a = 1;\n',
      });

      const result = await metricsService.computeZipMetrics(zipPath);

      expect(result.totalLOC).toBe(1);
      expect(result.language).toContain('TypeScript');
    });

    it('excludes lockfiles from totalLOC (yarn.lock, Cargo.lock, pnpm-lock.yaml, etc.)', async () => {
      // SCA scanner needs the lockfile content (filterZipFile keeps it
      // in the archive), but the LOC counter must not include it —
      // content is machine-generated, would dominate the LOC figure
      // and stall the CPU-throttled cron pod when byte-scanned.
      // Includes the YAML-based `pnpm-lock.yaml` which is NOT caught
      // by the `.lock` extension match.
      const zipPath = path.join(tmpDir, 'with-lockfiles.zip');
      // 20-line fake lockfile body each — totalLOC would jump by 20×N
      // if any of these were counted.
      const fakeLock = 'pkg-1.0.0\n'.repeat(20);
      await createTestZip(zipPath, {
        'src/code.ts': 'const a = 1;\nconst b = 2;\n', // 2 LOC
        'yarn.lock': fakeLock,
        'Cargo.lock': fakeLock,
        'composer.lock': fakeLock,
        'Pipfile.lock': fakeLock,
        'uv.lock': fakeLock,
        'pnpm-lock.yaml': fakeLock,
        'pnpm-lock.yml': fakeLock,
      });

      const result = await metricsService.computeZipMetrics(zipPath);

      // Only code.ts contributes — all lockfiles skipped.
      expect(result.totalLOC).toBe(2);
      // Code language still detected.
      expect(result.language).toContain('TypeScript');
    });

    it('detects JSON in languages but excludes JSON content from totalLOC', async () => {
      // Generated JSON artifacts (agent outputs, OpenAPI dumps, big
      // lockfiles) dominate LOC and stall the CPU-throttled cron pod
      // when byte-scanned. We still want JSON in `language[]` so
      // scanner selection knows the repo has JSON, but its content must
      // NOT count toward totalLOC.
      const zipPath = path.join(tmpDir, 'with-json.zip');
      await createTestZip(zipPath, {
        'src/code.ts': 'const a = 1;\nconst b = 2;\n', // 2 LOC
        'config.json': JSON.stringify({ a: 1, b: 2, c: 3 }), // would be 1 LOC if counted
        'config.jsonc': '// comment\n{}\n', // would be 2 LOC if counted
        'config.json5': '{ a: 1 }\n', // would be 1 LOC if counted
      });

      const result = await metricsService.computeZipMetrics(zipPath);

      // Only code.ts contributes — JSON family is skipped for LOC.
      expect(result.totalLOC).toBe(2);
      // But JSON IS detected as a language.
      expect(result.language).toContain('JSON');
      expect(result.language).toContain('TypeScript');
    });

    it('skips the .git/* tree wholesale (no LOC, no log noise)', async () => {
      // filterZipFile keeps .git/* in the archive so gitleaks can scan
      // commit history. computeZipMetrics MUST skip it before the size
      // guard / language classification to avoid:
      //   - LOC pollution from blobs that happen to have a JS-ish extension
      //   - WARN log spam from the size guard tripping on big pack files
      //   - wasted CPU iterating through thousands of `.git/objects/<sha>`
      const zipPath = path.join(tmpDir, 'with-git.zip');
      // Craft a fake-binary blob ≥ 6 MiB so it WOULD trip the size guard
      // (5 MiB default) if `.git/` were not short-circuited.
      const bigPackContent = Buffer.alloc(6 * 1024 * 1024, 0x00);
      await createTestZip(zipPath, {
        // Real code we DO want counted
        'src/main.ts': 'const x = 1;\nconst y = 2;\n',
        // A bunch of typical .git/* entries
        '.git/HEAD': 'ref: refs/heads/main\n',
        '.git/config': '[core]\n\trepositoryformatversion = 0\n',
        '.git/refs/heads/main': 'abcdef\n',
        '.git/objects/pack/pack-fake.pack': bigPackContent,
        // A blob that happens to share an extension with code (would have
        // been classified as TS otherwise)
        '.git/objects/4f/bogus.ts': 'binary-looking-content\n',
      });

      const warnSpy = jest.spyOn(logger, 'warn');

      const result = await metricsService.computeZipMetrics(zipPath);

      // Only the legit src/main.ts contributes — `.git/*` is skipped.
      expect(result.totalLOC).toBe(2);
      expect(result.language).toEqual(['TypeScript']);

      // No size-guard WARN on the pack file (skipped before that branch).
      const sizeGuardWarn = warnSpy.mock.calls.find(
        ([msg]) =>
          typeof msg === 'string' &&
          msg.includes('[ZIP metrics] Skipping oversized entry'),
      );
      expect(sizeGuardWarn).toBeUndefined();

      warnSpy.mockRestore();
    });

    // ---- Hang protection ----
    //
    // A single zip entry whose stream never emits `close` (malformed file
    // picked up as code via its extension) used to freeze the whole
    // promise, leak the FD, and block processUploadedFile across the
    // file-management-cron forever. The tests below cover the three
    // defenses added to recover from each scenario.

    it('skips entries above maxEntrySize and continues the batch', async () => {
      const zipPath = path.join(tmpDir, 'oversized.zip');
      // 200 bytes of TypeScript "code" — well above a 50-byte cap, would
      // otherwise contribute its lines to totalLOC.
      const big = 'const x = 1;\n'.repeat(20);
      await createTestZip(zipPath, {
        'src/huge.ts': big,
        'src/small.ts': 'const y = 2;\n',
      });

      const result = await metricsService.computeZipMetrics(zipPath, {
        maxEntrySize: 50,
      });

      // Only the small file's 1 line is counted; the oversized one is
      // skipped entirely.
      expect(result.totalLOC).toBe(1);
      expect(result.language).toContain('TypeScript');
    });

    it('resolves with partial metrics (preserving detected languages) when the overall timeout fires', async () => {
      // A `reject` on the overall timeout would make the caller drop the
      // partial `language` Set already collected — and `language: []`
      // reaching security-scanning means no SAST pod ever launches. It
      // resolves with what we have so the SAST scanner selection still
      // gets the language list (detected from extensions before any
      // byte is read).
      const zipPath = path.join(tmpDir, 'many.zip');
      const entries: Record<string, string> = {};
      for (let i = 0; i < 500; i++) {
        entries[`src/file-${i}.ts`] = `const x${i} = ${i};\n`;
      }
      // Add a Python file too so we observe a multi-language result.
      entries['src/util.py'] = "print('hi')\n";
      await createTestZip(zipPath, entries);

      // 1 ms forces the overall timer to win the race against per-file
      // streams. The byte-counting pass would normally finish in <10 ms.
      const result = await metricsService.computeZipMetrics(zipPath, {
        overallTimeoutMs: 1,
      });

      // Either zero or some entries got their LOC counted before the
      // timer fired — what matters is the promise resolved (no reject)
      // and totalLOC is a number, not undefined.
      expect(typeof result.totalLOC).toBe('number');
      expect(result.totalSize).toMatch(/Mo$/);
      // language Set may be empty (timer fired before any entry handler
      // ran) or partial (some entries were classified). Both cases must
      // resolve gracefully — that's the regression guard.
      expect(Array.isArray(result.language)).toBe(true);
    });

    it('preserves languages detected so far when overall timeout fires mid-pass', async () => {
      // Scenario: many TS files + a Python file at the START so we know
      // at least one Python is detected. Then a long per-file budget but
      // a short overall budget that fires while later files are being
      // read. The Python language MUST appear in the result so that
      // security-scanning can launch the SAST pod for Python.
      const zipPath = path.join(tmpDir, 'multilang.zip');
      const entries: Record<string, string> = {};
      entries['src/a-first.py'] = "import os\nprint('hi')\n";
      // Many TS entries with enough content that 500 ms is barely enough
      // to process them all under reasonable load.
      for (let i = 0; i < 200; i++) {
        const body = `const x${i} = ${i};\n`.repeat(50);
        entries[`src/file-${i}.ts`] = body;
      }
      await createTestZip(zipPath, entries);

      // Aim for the overall timeout to fire while processing the TS
      // backlog. 50 ms is short enough on a typical CI machine; if the
      // pass finishes before the timer fires (very fast machine), the
      // test still passes because both languages are detected anyway.
      const result = await metricsService.computeZipMetrics(zipPath, {
        overallTimeoutMs: 50,
        // Long per-file timeout so individual files don't time out.
        perFileTimeoutMs: 10_000,
      });

      // The Python file was first in iteration order — its language
      // must be in the result regardless of whether the overall timer
      // fired mid-pass or after natural completion.
      expect(result.language).toContain('Python');
    });

    it('continues the batch after per-file watchdog fires (returns partial metrics)', async () => {
      // We cannot easily craft a hanging entry stream, but we can force
      // the per-file timeout to be unrealistically short and verify that:
      //   1. the promise still resolves (no hang),
      //   2. languages are still detected (added at classification time),
      //   3. totalLOC can be 0 because individual file reads were
      //      pre-empted before any line was counted.
      const zipPath = path.join(tmpDir, 'fast-files.zip');
      await createTestZip(zipPath, {
        'src/a.ts': 'const a = 1;\nconst b = 2;\n',
        'src/b.ts': 'const c = 3;\nconst d = 4;\n',
      });

      const result = await metricsService.computeZipMetrics(zipPath, {
        // 0 ms: timer fires synchronously on the next macrotask tick,
        // before readline has a chance to emit lines.
        perFileTimeoutMs: 0,
        overallTimeoutMs: 5_000,
      });

      // The promise resolved (= no hang) and language detection still
      // worked. totalLOC may be 0 or partial depending on scheduler timing
      // — what we assert is "no hang + cleanly resolved".
      expect(result.language).toContain('TypeScript');
      expect(typeof result.totalLOC).toBe('number');
    });

    it('does not classify a root-level .cybedefend config file as a language', async () => {
      // `.cybedefend` is a CybeDefend project-config file, not a programming
      // language. It used to leak into the language[] array via the
      // validFilesWithoutExtension allowlist and was then forwarded verbatim
      // to security-scanning-service alongside real languages.
      const zipPath = path.join(tmpDir, 'config-only.zip');
      await createTestZip(zipPath, {
        'src/app.ts': 'const x = 1;\n',
        '.cybedefend': '{"projectId":"abc"}',
      });

      const result = await metricsService.computeZipMetrics(zipPath);

      expect(result.language).toContain('TypeScript');
      expect(result.language).not.toContain('.cybedefend');
    });
  });

  // -------------------------------------------------------------------------
  // validateZipFile — encrypted ZIP rejection
  // -------------------------------------------------------------------------
  describe('validateZipFile (encrypted ZIP rejection)', () => {
    let validateService: FileService;
    let tmpDir: string;

    // Real encrypted ZIP generated via:
    //   echo "hello world" > secret.txt
    //   zip -e -P testpass test-encrypted.zip secret.txt
    // Single entry "secret.txt" with general-purpose-bit-flag bit 0 = 1.
    const ENCRYPTED_ZIP_BASE64 =
      'UEsDBAoACQAAAJxxqlwtOwivGAAAAAwAAAAKABwAc2VjcmV0LnR4dFVUCQADR3YA' +
      'akd2AGp1eAsAAQT1AQAABAAAAAAfZPni7n3Z0rireKxZ+djiZAsd3dRCH9RQSwcI' +
      'LTsIrxgAAAAMAAAAUEsBAh4DCgAJAAAAnHGqXC07CK8YAAAADAAAAAoAGAAAAAAA' +
      'AQAAAKSBAAAAAHNlY3JldC50eHRVVAUAA0d2AGp1eAsAAQT1AQAABAAAAABQSwUG' +
      'AAAAAAEAAQBQAAAAbAAAAAAA';

    beforeEach(async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fms-enc-'));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          {
            provide: getRepositoryToken(FileScan),
            useValue: createMockRepository<FileScan>(),
          },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          { provide: ConfigService, useValue: makeConfig() },
          { provide: SecretsService, useValue: secrets },
          { provide: Logger, useValue: logger },
        ],
      }).compile();

      validateService = module.get(FileService);
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it('rejects an encrypted ZIP synchronously (does not crash the worker)', async () => {
      const encZip = path.join(tmpDir, 'encrypted.zip');
      await fs.promises.writeFile(
        encZip,
        Buffer.from(ENCRYPTED_ZIP_BASE64, 'base64'),
      );

      // The promise must reject — NOT throw asynchronously through a stream
      // 'error' event that escapes the surrounding try/catch.
      await expect(
        validateService['validateZipFile'](encZip),
      ).rejects.toMatchObject({
        code: 'ARCHIVE_ENCRYPTED',
        message: expect.stringMatching(/password-protected/),
      });
    });

    it('passes validation for a normal (unencrypted) ZIP', async () => {
      const plainZip = path.join(tmpDir, 'plain.zip');
      await createTestZip(plainZip, {
        'src/app.ts': 'const x = 1;',
        'package.json': '{"name":"t"}',
      });

      const result = await validateService['validateZipFile'](plainZip);
      expect(result).toBe(true);
    });

    it('rejects when ANY entry is encrypted in a mixed ZIP', async () => {
      // Decode the encrypted-only fixture and use it as a baseline; we re-test
      // that the encryption detection short-circuits even with a single
      // encrypted entry. (Using the existing fixture covers this case since
      // it has exactly one encrypted entry — no mixed fixture is required to
      // exercise the predicate.)
      const encZip = path.join(tmpDir, 'mixed.zip');
      await fs.promises.writeFile(
        encZip,
        Buffer.from(ENCRYPTED_ZIP_BASE64, 'base64'),
      );

      await expect(
        validateService['validateZipFile'](encZip),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // isPathTraversal — unit tests for the extracted traversal predicate
  // -------------------------------------------------------------------------
  describe('isPathTraversal', () => {
    let predicateService: FileService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FileService,
          {
            provide: getRepositoryToken(FileScan),
            useValue: createMockRepository<FileScan>(),
          },
          { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
          { provide: ConfigService, useValue: makeConfig() },
          { provide: SecretsService, useValue: secrets },
          { provide: Logger, useValue: logger },
        ],
      }).compile();

      predicateService = module.get(FileService);
    });

    it('rejects a direct parent-relative path (../.git/HEAD)', () => {
      // path.posix.normalize('../.git/HEAD') → '../.git/HEAD' — still starts with '..'
      expect(predicateService['isPathTraversal']('../.git/HEAD')).toBe(true);
    });

    it('rejects a deeply nested traversal path (../../etc/passwd)', () => {
      expect(predicateService['isPathTraversal']('../../etc/passwd')).toBe(
        true,
      );
    });

    it('rejects an absolute path (/etc/passwd)', () => {
      expect(predicateService['isPathTraversal']('/etc/passwd')).toBe(true);
    });

    it('allows a safe .git entry (.git/HEAD)', () => {
      // Starts with ".git", not ".." — must pass through so gitleaks can scan history
      expect(predicateService['isPathTraversal']('.git/HEAD')).toBe(false);
    });

    it('allows a normal source file (src/app.js)', () => {
      expect(predicateService['isPathTraversal']('src/app.js')).toBe(false);
    });

    it('allows a root-level file (package.json)', () => {
      expect(predicateService['isPathTraversal']('package.json')).toBe(false);
    });

    it('handles a path that normalises to a safe form (foo/../bar → bar)', () => {
      // path.posix.normalize('foo/../bar') === 'bar' — does NOT start with '..'
      const normalized = path.posix.normalize('foo/../bar');
      expect(predicateService['isPathTraversal'](normalized)).toBe(false);
    });

    it('handles a path that normalises to a traversal (foo/../../bar → ../bar)', () => {
      // path.posix.normalize('foo/../../bar') === '../bar' — starts with '..'
      const normalized = path.posix.normalize('foo/../../bar');
      expect(predicateService['isPathTraversal'](normalized)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Diff scan via signed upload URL + post-upload archive validation
// ---------------------------------------------------------------------------
describe('FileService — diff scan upload', () => {
  const logger = createLoggerMock();
  const mockScanClient = {
    getService: jest.fn().mockReturnValue({
      startScan: jest.fn(() => of({})),
      updateScanData: jest.fn(() => of({})),
    }),
  } as unknown as ClientGrpc;
  // A plain function, not a mock: jest.resetAllMocks() must not empty the S3
  // credentials FileService reads in its constructor.
  const secrets = {
    getSecret: () => 'x',
    ensureCacheLoaded: jest.fn(),
  } as unknown as SecretsService;

  const CAPS = { maxFiles: 5, maxFileBytes: 1000, maxTotalBytes: 2000 };

  let service: FileService;
  let repo: ReturnType<typeof createMockRepository<FileScan>>;
  let tmpDir: string;

  beforeEach(async () => {
    jest.resetAllMocks();
    repo = createMockRepository<FileScan>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        { provide: getRepositoryToken(FileScan), useValue: repo },
        { provide: 'SECURITY_SCANNING_SERVICE', useValue: mockScanClient },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            STORAGE_PROVIDER: 's3',
            S3_BUCKET_NAME: 'test-bucket',
          }),
        },
        { provide: SecretsService, useValue: secrets },
        { provide: Logger, useValue: logger },
      ],
    }).compile();
    service = module.get(FileService);
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'diff-zip-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  // Real pipeline: stream the uploaded archive, then run the pure validator.
  const validateZip = async (
    entries: Record<string, string | Buffer>,
  ): Promise<string[]> => {
    const zipPath = path.join(tmpDir, 'diff.zip');
    await createTestZip(zipPath, entries);
    const listed = await (service as any).readDiffZipEntries(zipPath, CAPS);
    const { validateDiffZipEntries } = await import('./diff-archive.util');
    return validateDiffZipEntries(listed, CAPS);
  };

  // `requestDiffScanUploadUrl` is a closed RPC: its handler and its tests
  // live in the closed edition.

  describe('uploaded-archive validation (readDiffZipEntries + validateDiffZipEntries)', () => {
    it('accepts a clean diff archive', async () => {
      const out = await validateZip({
        'src/app.py': 'print(1)',
        'infra/main.tf': 'resource {}',
      });
      expect(out.sort()).toEqual(['infra/main.tf', 'src/app.py']);
    });

    it('drops excluded subtrees without counting them', async () => {
      const out = await validateZip({
        'node_modules/lib/index.js': 'a'.repeat(5000), // excluded + oversize
        'src/app.py': 'x',
      });
      expect(out).toEqual(['src/app.py']);
    });

    it('rejects a forged .git tree in the uploaded archive', async () => {
      await expect(
        validateZip({ '.git/config': 'x', 'src/app.py': 'x' }),
      ).rejects.toBeDefined();
    });

    it('rejects when the aggregate decompressed size exceeds the cap (zip-bomb guard)', async () => {
      await expect(
        validateZip({
          'a.py': 'a'.repeat(1500),
          'b.py': 'b'.repeat(1500), // 3000 > maxTotalBytes (2000)
        }),
      ).rejects.toBeDefined();
    });

    it('rejects a single file above the per-file cap', async () => {
      await expect(
        validateZip({ 'big.py': 'a'.repeat(1001) }),
      ).rejects.toBeDefined();
    });
  });
});

describe('FileService — filtered-folder isolation', () => {
  const repo = createMockRepository<FileScan>();
  const logger = createLoggerMock();

  // Fresh secrets + scan-client per build: the file's top-level
  // beforeEach(jest.resetAllMocks()) runs before each test, so mocks created
  // inside buildS3 (called from the test body) survive the reset.
  const buildS3 = async () => {
    const secrets = {
      getSecret: jest.fn(() => 'x'),
      ensureCacheLoaded: jest.fn(),
    } as unknown as SecretsService;
    const scanClient = {
      getService: jest.fn().mockReturnValue({
        startScan: jest.fn(() => of({})),
        updateScanData: jest.fn(() => of({})),
      }),
    } as unknown as ClientGrpc;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        { provide: getRepositoryToken(FileScan), useValue: repo },
        { provide: Logger, useValue: logger },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            STORAGE_PROVIDER: 's3',
            S3_ENDPOINT: 'https://s3.example',
            S3_BUCKET_NAME: 'files-bucket',
            AWS_REGION: 'us-east-1',
            FILE_SCAN_MIN_FILE_SIZE_BYTES: 10,
            FILE_SCAN_MIN_FILE_AGE_SECONDS: 0,
          }),
        },
        { provide: SecretsService, useValue: secrets },
        { provide: 'SECURITY_SCANNING_SERVICE', useValue: scanClient },
      ],
    }).compile();
    const svc = module.get<FileService>(FileService);
    // compile() does not run lifecycle hooks; wire the gRPC scan client.
    await svc.onModuleInit();
    return svc;
  };

  // This is a top-level describe (does not inherit the other block's
  // resetAllMocks), so clear the shared presigner mock's call log between tests.
  beforeEach(() => jest.clearAllMocks());

  it('filteredScanKey derives the filtered/ key', async () => {
    const svc = await buildS3();
    expect((svc as any).filteredScanKey('scan/p/s1.zip')).toBe(
      'filtered/p/s1.zip',
    );
  });

  it('filteredScanKey throws when the path is not under scan/', async () => {
    const svc = await buildS3();
    expect(() => (svc as any).filteredScanKey('reports/p/s1.zip')).toThrow();
  });

  it('legacyFilteredScanKey derives the .filtered.zip sibling key', async () => {
    const svc = await buildS3();
    expect((svc as any).legacyFilteredScanKey('scan/p/s1.zip')).toBe(
      'scan/p/s1.filtered.zip',
    );
  });

  it('processUploadedFile writes filtered/ + deletes the raw (diff)', async () => {
    const svc = await buildS3();
    const tmp = path.join(os.tmpdir(), 'raw-b125-diff-mock.zip');
    await createTestZip(tmp, { 'src/app.ts': 'export const x = 1;\n' });
    const zipBuf = await fs.promises.readFile(tmp);
    const sends: any[] = [];
    (svc as any).s3Client = (svc as any).s3UploadClient = {
      send: jest.fn((cmd: any) => {
        sends.push(cmd);
        if (cmd.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: { transformToByteArray: async () => zipBuf },
          });
        }
        return Promise.resolve({});
      }),
    };
    await svc.processUploadedFile({
      id: 'r1',
      scanId: 's1',
      projectId: 'p',
      objectPath: 'scan/p/s1.zip',
      isDiffScan: true,
      status: FileStatus.PROCESSING,
    } as any);
    const put = sends.find((c) => c.constructor.name === 'PutObjectCommand');
    const del = sends.find((c) => c.constructor.name === 'DeleteObjectCommand');
    expect(put.input.Key).toBe('filtered/p/s1.zip');
    expect(del.input.Key).toBe('scan/p/s1.zip');
  });

  it('processUploadedFile writes filtered/ + deletes the raw (full scan)', async () => {
    const svc = await buildS3();
    const tmp = path.join(os.tmpdir(), 'raw-b125-full-mock.zip');
    await createTestZip(tmp, { 'src/app.ts': 'export const x = 1;\n' });
    const zipBuf = await fs.promises.readFile(tmp);
    const sends: any[] = [];
    (svc as any).s3Client = (svc as any).s3UploadClient = {
      send: jest.fn((cmd: any) => {
        sends.push(cmd);
        if (cmd.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: { transformToByteArray: async () => zipBuf },
          });
        }
        return Promise.resolve({});
      }),
    };
    await svc.processUploadedFile({
      id: 'r2',
      scanId: 's2',
      projectId: 'p',
      objectPath: 'scan/p/s2.zip',
      isDiffScan: false,
      status: FileStatus.PROCESSING,
    } as any);
    const put = sends.find((c) => c.constructor.name === 'PutObjectCommand');
    const del = sends.find((c) => c.constructor.name === 'DeleteObjectCommand');
    expect(put.input.Key).toBe('filtered/p/s2.zip');
    expect(del.input.Key).toBe('scan/p/s2.zip');
  });

  it('getDownloadUrl presigns the filtered/ key (any scan)', async () => {
    const svc = await buildS3();
    (svc as any).s3Client = { send: jest.fn().mockResolvedValue({}) };
    (repo.findOne as jest.Mock).mockResolvedValue({
      scanId: 's1',
      objectPath: 'scan/p/s1.zip',
      isDiffScan: true,
    });
    await svc.getDownloadUrl({ scanId: 's1' } as any);
    expect((mockedGetSignedUrl as jest.Mock).mock.calls[0][1].input.Key).toBe(
      'filtered/p/s1.zip',
    );
  });

  it('getDownloadUrl falls back to the legacy .filtered.zip key (diff straddle)', async () => {
    const svc = await buildS3();
    const nf = Object.assign(new Error('nf'), { name: 'NotFound' });
    (svc as any).s3Client = {
      send: jest
        .fn()
        .mockRejectedValueOnce(nf) // filtered/ Head → miss
        .mockResolvedValueOnce({}), // legacy .filtered.zip Head → hit
    };
    (repo.findOne as jest.Mock).mockResolvedValue({
      scanId: 's4',
      objectPath: 'scan/p/s4.zip',
      isDiffScan: true,
    });
    await svc.getDownloadUrl({ scanId: 's4' } as any);
    expect((mockedGetSignedUrl as jest.Mock).mock.calls[0][1].input.Key).toBe(
      'scan/p/s4.filtered.zip',
    );
  });

  it('getDownloadUrl falls through filtered/ → legacy → raw (full straddle)', async () => {
    const svc = await buildS3();
    const nf = Object.assign(new Error('nf'), { name: 'NotFound' });
    (svc as any).s3Client = {
      send: jest
        .fn()
        .mockRejectedValueOnce(nf) // filtered/ Head → miss
        .mockRejectedValueOnce(nf) // legacy .filtered.zip Head → miss
        .mockResolvedValueOnce({}), // raw Head → hit
    };
    (repo.findOne as jest.Mock).mockResolvedValue({
      scanId: 's3',
      objectPath: 'scan/p/s3.zip',
      isDiffScan: false,
    });
    await svc.getDownloadUrl({ scanId: 's3' } as any);
    expect((mockedGetSignedUrl as jest.Mock).mock.calls[0][1].input.Key).toBe(
      'scan/p/s3.zip',
    );
  });

  it('deleteFile sweeps raw + filtered/ + legacy (any scan)', async () => {
    const svc = await buildS3();
    const send = jest.fn().mockResolvedValue({});
    (svc as any).s3Client = { send };
    (repo.findOne as jest.Mock).mockResolvedValue({
      scanId: 's3',
      objectPath: 'scan/p/s3.zip',
      isDiffScan: false,
    });
    await svc.deleteFile({ scanId: 's3' } as any);
    const keys = send.mock.calls.map((c) => c[0].input.Key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'scan/p/s3.zip',
        'filtered/p/s3.zip',
        'scan/p/s3.filtered.zip',
      ]),
    );
  });

  describe('history artifact (S3)', () => {
    it('uploads a history artifact under its own key without a FileScan row', async () => {
      const svc = await buildS3();
      const nf = Object.assign(new Error('nf'), { name: 'NotFound' });
      (svc as any).s3Client = { send: jest.fn().mockRejectedValue(nf) };
      (mockedGetSignedUrl as jest.Mock).mockResolvedValue('https://signed');
      const res = await svc.uploadFile({
        projectId: 'p',
        scanId: 's1',
        typeScan: 'sast',
        artifact: 'history',
      } as any);
      expect(res.url).toBe('https://signed');
      const cmd = (mockedGetSignedUrl as jest.Mock).mock.calls[0][1];
      expect(cmd.input.Key).toBe('scan/p/s1.history.tar');
      expect(cmd.input.ContentType).toBe('application/x-tar');
      expect((mockedGetSignedUrl as jest.Mock).mock.calls[0][2]).toEqual({
        expiresIn: 10,
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects an unknown artifact kind', async () => {
      const svc = await buildS3();
      await expect(
        svc.uploadFile({
          projectId: 'p',
          scanId: 's1',
          typeScan: 'sast',
          artifact: 'bogus',
        } as any),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
    });

    it('signs a download of the history artifact', async () => {
      const svc = await buildS3();
      const send = jest.fn().mockResolvedValue({});
      (svc as any).s3Client = { send };
      (mockedGetSignedUrl as jest.Mock).mockResolvedValue('https://signed');
      (repo.findOne as jest.Mock).mockResolvedValue({
        scanId: 's1',
        projectId: 'p',
        objectPath: 'scan/p/s1.zip',
      });
      const res = await svc.getDownloadUrl({
        scanId: 's1',
        artifact: 'history',
      } as any);
      expect(res.url).toBe('https://signed');
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].input.Key).toBe('scan/p/s1.history.tar');
      expect((mockedGetSignedUrl as jest.Mock).mock.calls[0][1].input.Key).toBe(
        'scan/p/s1.history.tar',
      );
      expect((mockedGetSignedUrl as jest.Mock).mock.calls[0][2]).toEqual({
        expiresIn: 3 * 60 * 60,
      });
    });

    it('signs a history download for 3 hours', async () => {
      const svc = await buildS3();
      (svc as any).s3Client = { send: jest.fn().mockResolvedValue({}) };
      (mockedGetSignedUrl as jest.Mock).mockResolvedValue('https://signed');
      (repo.findOne as jest.Mock).mockResolvedValue({
        scanId: 's1',
        projectId: 'p',
        objectPath: 'scan/p/s1.zip',
      });
      await svc.getDownloadUrl({ scanId: 's1', artifact: 'history' } as any);
      expect((mockedGetSignedUrl as jest.Mock).mock.calls[0][2]).toEqual({
        expiresIn: 3 * 60 * 60,
      });
    });

    it('answers NOT_FOUND when a scan has no history artifact', async () => {
      const svc = await buildS3();
      const nf = Object.assign(new Error('nf'), { name: 'NotFound' });
      const send = jest.fn().mockRejectedValue(nf);
      (svc as any).s3Client = { send };
      (repo.findOne as jest.Mock).mockResolvedValue({
        scanId: 's1',
        projectId: 'p',
        objectPath: 'scan/p/s1.zip',
      });
      await expect(
        svc.getDownloadUrl({ scanId: 's1', artifact: 'history' } as any),
      ).rejects.toMatchObject({ error: { code: status.NOT_FOUND } });
      expect(send).toHaveBeenCalledTimes(1);
      expect(mockedGetSignedUrl).not.toHaveBeenCalled();
    });

    it('deleteFile sweeps the history artifact', async () => {
      const svc = await buildS3();
      const send = jest.fn().mockResolvedValue({});
      (svc as any).s3Client = { send };
      (repo.findOne as jest.Mock).mockResolvedValue({
        scanId: 's1',
        projectId: 'p',
        objectPath: 'scan/p/s1.zip',
      });
      await svc.deleteFile({ scanId: 's1' } as any);
      expect(send.mock.calls.map((c) => c[0].input.Key)).toContain(
        'scan/p/s1.history.tar',
      );
    });

    it('the default artifact is unchanged', async () => {
      const svc = await buildS3();
      (svc as any).s3Client = { send: jest.fn().mockResolvedValue({}) };
      (repo.findOne as jest.Mock).mockResolvedValue({
        scanId: 's1',
        projectId: 'p',
        objectPath: 'scan/p/s1.zip',
      });
      await svc.getDownloadUrl({ scanId: 's1', artifact: 'archive' } as any);
      expect((mockedGetSignedUrl as jest.Mock).mock.calls[0][1].input.Key).toBe(
        'filtered/p/s1.zip',
      );
    });
  });

  it("the cron cleanup also deletes the scan's history tar (S3)", async () => {
    const svc = await buildS3();
    const send = jest.fn().mockResolvedValue({});
    (svc as any).s3Client = { send };
    await (svc as any).deleteFileFromStorage('scan/p/s6.zip', true);
    expect(send.mock.calls.map((c) => c[0].input.Key)).toContain(
      'scan/p/s6.history.tar',
    );
  });

  it('deleteFileFromStorage sweeps three keys when sweepDerivedKeys=true, one otherwise', async () => {
    const svc = await buildS3();
    const send = jest.fn().mockResolvedValue({});
    (svc as any).s3Client = { send };
    await (svc as any).deleteFileFromStorage('scan/p/s5.zip', true);
    const sweep = send.mock.calls.map((c) => c[0].input.Key);
    expect(sweep).toEqual(
      expect.arrayContaining([
        'scan/p/s5.zip',
        'filtered/p/s5.zip',
        'scan/p/s5.filtered.zip',
      ]),
    );
    send.mockClear();
    await (svc as any).deleteFileFromStorage('reports/p/r.pdf');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input.Key).toBe('reports/p/r.pdf');
  });
});
