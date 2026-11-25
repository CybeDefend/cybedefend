import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { of } from 'rxjs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { Logger } from 'nestjs-pino';

import { FileService } from './file.service';
import { FileScan, FileStatus } from 'src/entities/file.entity';
import { createLoggerMock, createMockRepository } from 'src/test-utils/mocks';
import { writeZip } from 'src/test-utils/zip-fixtures';
import SecretsService from 'src/core/secrets/secrets.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/s3'),
}));

/**
 * The scan records what the upload filter left out of the archive the
 * scanners read: file-management sends it with the call that starts the
 * scan.
 */
describe('FileService — what the upload filter leaves out', () => {
  let dir: string;
  let startScan: jest.Mock;

  const build = async () => {
    startScan = jest.fn(() => of({}));
    const scanClient = {
      getService: jest
        .fn()
        .mockReturnValue({ startScan, updateScanData: jest.fn(() => of({})) }),
    } as unknown as ClientGrpc;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        {
          provide: getRepositoryToken(FileScan),
          useValue: createMockRepository<FileScan>(),
        },
        { provide: Logger, useValue: createLoggerMock() },
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
        {
          provide: SecretsService,
          useValue: {
            getSecret: jest.fn(() => 'x'),
            ensureCacheLoaded: jest.fn(),
          },
        },
        { provide: 'SECURITY_SCANNING_SERVICE', useValue: scanClient },
      ],
    }).compile();
    const svc = module.get<FileService>(FileService);
    await svc.onModuleInit();
    return svc;
  };

  /** Serve `zipBuf` as the uploaded object, as the SDK does (a stream). */
  const serve = (svc: FileService, zipBuf: Buffer) => {
    (svc as any).s3UploadClient = undefined;
    (svc as any).s3Client = {
      send: jest.fn((cmd: { constructor: { name: string } }) =>
        Promise.resolve(
          cmd.constructor.name === 'GetObjectCommand'
            ? { ContentLength: zipBuf.length, Body: Readable.from([zipBuf]) }
            : {},
        ),
      ),
    };
  };

  const FILES: Record<string, string> = {
    'src/app.py': 'print(1)\n',
    'requirements.txt': 'flask\n',
    'build/app.js': 'eval(location.hash)\n',
    'build/vendor.js': 'x\n',
    'build/lib/util.js': 'y\n',
    'web/dist/main.js': 'z\n',
    'deploy/prod.log': 'secret\n',
    'img/logo.png': 'png',
    '.gitleaks.toml': '[allowlist]\npaths = [".*"]\n',
  };

  const EXPECTED = {
    scannerConfiguration: 1,
    excludedPath: 5,
    excludedType: 1,
    unsafeName: 0,
    gitMetadata: 0,
    excludedFolders: [
      { name: 'build', count: 3 },
      { name: 'web/dist', count: 1 },
    ],
  };

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fms-summary-'));
  });
  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('summarises by reason the files left out, with their excluded folders', async () => {
    const svc = await build();
    const input = path.join(dir, 'in.zip');
    await writeZip(input, FILES);
    const { summary } = await (svc as any).filterArchive(input, dir);
    expect(summary).toEqual(EXPECTED);
  });

  it('names at most 20 excluded folders of an archive that has 30', async () => {
    const svc = await build();
    const files: Record<string, string> = { 'src/app.py': 'print(1)\n' };
    for (let i = 0; i < 30; i++) {
      files[`pkg${String(i).padStart(2, '0')}/dist/a.js`] = 'x\n';
    }
    const input = path.join(dir, 'many.zip');
    await writeZip(input, files);
    const { summary } = await (svc as any).filterArchive(input, dir);
    expect(summary.excludedPath).toBe(30);
    expect(summary.excludedFolders).toHaveLength(20);
    expect(summary.excludedFolders[0]).toEqual({
      name: 'pkg00/dist',
      count: 1,
    });
  });

  it('sends the summary with the call that starts the scan', async () => {
    const svc = await build();
    const input = path.join(dir, 'upload.zip');
    await writeZip(input, FILES);
    serve(svc, await fs.promises.readFile(input));

    await expect(
      svc.processUploadedFile({
        id: 'f1',
        scanId: 'scan-f1',
        projectId: 'p',
        objectPath: 'scan/p/f1.zip',
        isDiffScan: false,
        status: FileStatus.PROCESSING,
      } as FileScan),
    ).resolves.toBe(true);

    expect(startScan).toHaveBeenCalledTimes(1);
    expect(startScan.mock.calls[0][0]).toMatchObject({
      scanId: 'scan-f1',
      projectId: 'p',
      uploadFilterSummary: EXPECTED,
    });
  });
});
