import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { of } from 'rxjs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import * as yauzl from 'yauzl';
import { Logger } from 'nestjs-pino';

import { FileService } from './file.service';
import {
  ARCHIVE_FAILURE_CODES,
  ArchiveLimitError,
  COMMUNITY_SCANNER_ARCHIVE_LIMITS,
} from './zip-limits.util';
import { FileScan, FileStatus } from 'src/entities/file.entity';
import { createLoggerMock, createMockRepository } from 'src/test-utils/mocks';
import { lieAboutSizes, writeZip } from 'src/test-utils/zip-fixtures';
import SecretsService from 'src/core/secrets/secrets.service';
import {
  craftZip,
  endRecordInCommentZip,
  endRecordInDirectoryZip,
  overlappingRecordsZip,
  twoEndRecordsZip,
  unaccountedDataZip,
} from './crafted-zip.fixture-spec';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/s3'),
}));

const MIB = 1024 * 1024;

/**
 * What the filter keeps of the scanner-configuration archive below: exactly
 * what it kept before, minus the scanners' configuration files.
 */
const SCANNER_CONFIG_ARCHIVE_KEPT: string[] = [
  '.github/workflows/ci.yml',
  '.trivyignore.yaml',
  'Dockerfile',
  'app.py',
  'config/settings.yaml',
  'infra/main.tf',
  'requirements.txt',
];

/** What the filter keeps of the varied archive below. */
const VARIED_ARCHIVE_KEPT: string[] = [
  '.cybedefend/config.json',
  '.env.example',
  '.git/HEAD',
  '.git/config',
  '.git/refs/heads/main',
  'Dockerfile',
  'LICENSE',
  'README.md',
  'app/main.py',
  'docs/guide.md',
  'key.pem',
  'package.json',
  'requirements.txt',
  'src/café/é.ts',
];

/** Small limits, so a test archive of a few megabytes crosses them. */
const LIMITS = {
  FULL_SCAN_MAX_ARCHIVE_BYTES: 2 * MIB,
  FULL_SCAN_MAX_ENTRIES: 20,
  FULL_SCAN_MAX_ENTRY_BYTES: MIB,
  FULL_SCAN_MAX_UNCOMPRESSED_BYTES: 3 * MIB,
};

async function readZip(zipPath: string): Promise<Record<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const out: Record<string, Buffer> = {};
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zf) => {
      if (err) return reject(err);
      zf.on('entry', (entry: yauzl.Entry) => {
        zf.openReadStream(entry, (e, rs) => {
          if (e) return reject(e);
          const chunks: Buffer[] = [];
          rs.on('data', (c: Buffer) => chunks.push(c));
          rs.on('end', () => {
            out[entry.fileName] = Buffer.concat(chunks);
            zf.readEntry();
          });
        });
      });
      zf.on('end', () => resolve(out));
      zf.on('error', reject);
      zf.readEntry();
    });
  });
}

describe('FileService — full-scan archive limits', () => {
  let dir: string;
  let repo: ReturnType<typeof createMockRepository<FileScan>>;
  let startScan: jest.Mock;
  let updateScanData: jest.Mock;

  const build = async (over: Record<string, unknown> = {}) => {
    repo = createMockRepository<FileScan>();
    startScan = jest.fn(() => of({}));
    updateScanData = jest.fn(() => of({}));
    const scanClient = {
      getService: jest.fn().mockReturnValue({ startScan, updateScanData }),
    } as unknown as ClientGrpc;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        { provide: getRepositoryToken(FileScan), useValue: repo },
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
            ...LIMITS,
            ...over,
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
  const serve = (
    svc: FileService,
    zipBuf: Buffer,
    contentLength: number | undefined = zipBuf.length,
  ) => {
    const sends: any[] = [];
    (svc as any).s3UploadClient = undefined;
    (svc as any).s3Client = {
      send: jest.fn((cmd: any) => {
        sends.push(cmd);
        if (cmd.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            ContentLength: contentLength,
            Body: Readable.from([zipBuf]),
          });
        }
        return Promise.resolve({});
      }),
    };
    return sends;
  };

  const record = (id: string) =>
    ({
      id,
      scanId: `scan-${id}`,
      projectId: 'p',
      objectPath: `scan/p/${id}.zip`,
      isDiffScan: false,
      status: FileStatus.PROCESSING,
    }) as any;

  const zipOf = async (entries: Record<string, Buffer | string>) => {
    const p = path.join(dir, `in-${Math.random().toString(36).slice(2)}.zip`);
    await writeZip(p, entries);
    return fs.promises.readFile(p);
  };

  /** The signed browser PUT carries no size bound on S3: a refused upload is removed. */
  const expectDeleted = (sends: any[], id: string) => {
    const deletes = sends
      .filter((c) => c.constructor.name === 'DeleteObjectCommand')
      .map((c) => c.input.Key);
    expect(deletes).toContain(`scan/p/${id}.zip`);
  };

  /**
   * The scan is failed with the refusal's stable code (a number in the
   * archive range, its name leading the message) and a message naming the
   * limit, never a path of this service.
   */
  const expectRejected = (
    sends: any[],
    id: string,
    code: keyof typeof ARCHIVE_FAILURE_CODES,
    pattern: RegExp,
  ) => {
    expect(startScan).not.toHaveBeenCalled();
    expect(sends.some((c) => c.constructor.name === 'PutObjectCommand')).toBe(
      false,
    );
    expect(repo.update).toHaveBeenCalledWith(
      { id },
      { status: FileStatus.FAILED },
    );
    expectFailedWith(code, pattern);
  };

  const expectFailedWith = (
    code: keyof typeof ARCHIVE_FAILURE_CODES,
    pattern: RegExp,
  ) => {
    expect(updateScanData).toHaveBeenCalledTimes(1);
    const call = (updateScanData.mock.calls[0] as unknown[])[0] as {
      state: string;
      errorMessage: string;
      errorCode: number;
      errorCategory: string;
    };
    expect(call.state).toBe('failed');
    expect(call.errorCode).toBe(ARCHIVE_FAILURE_CODES[code]);
    expect(call.errorCategory).toBe('archive');
    expect(call.errorMessage.startsWith(`${code}: `)).toBe(true);
    expect(call.errorMessage).toMatch(pattern);
    expect(call.errorMessage).not.toMatch(/original\.zip|uploads|\/tmp|fms-/);
    expect(call.errorMessage.length).toBeLessThanOrEqual(255);
  };

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fms-limits-'));
  });
  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  describe('filterZipFile', () => {
    it('copies every kept entry byte for byte', async () => {
      const svc = await build();
      const big = Buffer.alloc(900 * 1024, 'a');
      const input = path.join(dir, 'ok.zip');
      await writeZip(input, {
        'src/app.ts': 'export const x = 1;\n',
        'src/big.ts': big,
        'package.json': '{"name":"x"}',
        '.git/HEAD': 'ref: refs/heads/main',
        'node_modules/dep/index.js': 'module.exports = 1;',
      });
      const out = await (svc as any).filterZipFile(input, dir);
      const entries = await readZip(out);
      expect(Object.keys(entries).sort()).toEqual([
        '.git/HEAD',
        '.git/config',
        'package.json',
        'src/app.ts',
        'src/big.ts',
      ]);
      expect(entries['src/big.ts'].equals(big)).toBe(true);
      expect(entries['src/app.ts'].toString()).toBe('export const x = 1;\n');
    });

    it('keeps exactly the same entries of a varied archive, byte for byte', async () => {
      const svc = await build({ FULL_SCAN_MAX_ENTRIES: 100 });
      const SQL = "def q(db, u):\n    return db.execute('SELECT ' + u)\n";
      const files: Record<string, string> = {
        'app/main.py': SQL,
        'app/env/handlers.py': SQL,
        'app/out/routes.py': SQL,
        'cmd/bin/server.go': 'package main\n',
        'src/target/Api.java': 'class Api{}\n',
        'web/build/app.js': 'eval(location.hash)\n',
        'lib/tmp/db.py': SQL,
        'config/.cache/settings.py': 'k = 1\n',
        'deploy/prod.log': 'secret\n',
        'scripts/deploy': '#!/bin/sh\necho hi\n',
        'key.pem': '-----BEGIN KEY-----\nMIIB\n-----END KEY-----\n',
        'infra/env/main.tf': 'resource "x" "y" {}\n',
        'k8s/out/deploy.yaml': 'kind: Pod\n',
        Dockerfile: 'FROM alpine\n',
        'docker/build/Dockerfile': 'FROM alpine\n',
        'README.md': '# readme\n',
        'docs/guide.md': '# guide\n',
        LICENSE: 'MIT\n',
        'img/logo.png': 'png',
        'node_modules/dep/index.js': 'module.exports = 1;\n',
        'vendor/lib.php': '<?php\n',
        'package.json': '{"name":"x"}\n',
        'requirements.txt': 'flask\n',
        '.env.example': 'A=1\n',
        'src/café/é.ts': 'export const é = 1;\n',
        'src/empty/': '',
        '.git/HEAD': 'ref: refs/heads/main\n',
        '.git/config': '[core]\n\tfsmonitor = id\n',
        '.git/hooks/pre-commit': '#!/bin/sh\n',
        '.git/refs/heads/main': '0000\n',
        '.gitattributes': '* diff=x\n',
        '.gitmodules': '[submodule "x"]\n',
        'sub/.git': 'gitdir: /etc\n',
        '.cybedefend/config.json': '{}\n',
        '.gitleaksignore': 'config.py:github-pat:2\n',
        '.trivyignore': 'CVE-2019-14234\n',
        '.semgrepignore': 'app.py\n',
        '.checkovignore': 'Dockerfile\n',
      };
      const input = path.join(dir, 'varied.zip');
      await writeZip(input, files);
      const out = await (svc as any).filterZipFile(input, dir);
      const entries = await readZip(out);
      expect(Object.keys(entries).sort()).toEqual(VARIED_ARCHIVE_KEPT);
      for (const name of VARIED_ARCHIVE_KEPT) {
        if (name === '.git/config') continue;
        expect(entries[name].toString()).toBe(files[name]);
      }
    });

    it("drops the scanners' configuration files and leaves every other entry as before", async () => {
      const svc = await build({ FULL_SCAN_MAX_ENTRIES: 100 });
      const files: Record<string, string> = {
        '.gitleaks.toml': '[allowlist]\npaths = [".*"]\n',
        'gitleaks.toml': '[allowlist]\npaths = [".*"]\n',
        'trivy.yaml': 'scan:\n  skip-files: [requirements.txt]\n',
        'trivy.yml': 'severity: [UNKNOWN]\n',
        'zizmor.yml': 'rules:\n  artipacked:\n    disable: true\n',
        'zizmor.yaml': 'rules: {}\n',
        '.github/zizmor.yml': 'rules: {}\n',
        '.github/zizmor.yaml': 'rules: {}\n',
        '.checkov.yaml': 'skip-check: [CKV_DOCKER_3]\n',
        '.checkov.yml': 'skip-check: [CKV_DOCKER_3]\n',
        'services/api/.gitleaks.toml': '[allowlist]\n',
        'services/api/trivy.yaml': 'severity: [UNKNOWN]\n',
        'services/api/zizmor.yml': 'rules: {}\n',
        'services/api/.checkov.yml': 'skip-check: []\n',
        '.gitleaksignore': 'config.py:github-pat:2\n',
        '.trivyignore': 'CVE-2019-14234\n',
        '.trivyignore.yaml': 'vulnerabilities: []\n',
        '.semgrepignore': 'app.py\n',
        '.checkovignore': 'Dockerfile\n',
        'services/api/.trivyignore': 'DS002\n',
        'app.py': 'print(eval(input()))\n',
        'requirements.txt': 'django==2.2\n',
        Dockerfile: 'FROM alpine\n',
        '.github/workflows/ci.yml': 'on: push\njobs: {}\n',
        'node_modules/dep/.trivyignore': 'CVE-0000-0000\n',
        'config/settings.yaml': 'debug: true\n',
        'infra/main.tf': 'resource "x" "y" {}\n',
      };
      const input = path.join(dir, 'scanner-config.zip');
      await writeZip(input, files);
      const { path: out, dropped } = await (svc as any).filterArchive(
        input,
        dir,
      );
      const entries = await readZip(out);
      expect(Object.keys(entries).sort()).toEqual(SCANNER_CONFIG_ARCHIVE_KEPT);
      for (const name of SCANNER_CONFIG_ARCHIVE_KEPT) {
        expect(entries[name].toString()).toBe(files[name]);
      }
      expect(dropped.scannerConfiguration).toBe(14);
      // Every other entry left out is counted under its existing reason.
      expect(dropped.excludedType).toBe(5);
      expect(dropped.excludedPath).toBe(1);
    });

    it('keeps every entry of an archive of many files, its central directory written one record per chunk', async () => {
      const svc = await build({ FULL_SCAN_MAX_ENTRIES: 1000 });
      const files: Record<string, string> = {};
      for (let i = 0; i < 600; i++) {
        files[`src/m${i}/index.ts`] = `export const v${i} = ${i};\n`;
      }
      const input = path.join(dir, 'many.zip');
      await writeZip(input, files);
      const out = await (svc as any).filterZipFile(input, dir);
      const entries = await readZip(out);
      expect(Object.keys(entries).sort()).toEqual(Object.keys(files).sort());
      for (const [name, content] of Object.entries(files)) {
        expect(entries[name].toString()).toBe(content);
      }
    });

    it('aborts an entry that inflates past the entry limit although it declares 10 bytes', async () => {
      const svc = await build();
      const honest = await zipOf({ 'src/liar.ts': Buffer.alloc(8 * MIB) });
      const input = path.join(dir, 'liar.zip');
      await fs.promises.writeFile(input, lieAboutSizes(honest, 10));
      await expect((svc as any).filterZipFile(input, dir)).rejects.toThrow(
        ArchiveLimitError,
      );
    });

    it('meters the entries of the .git passthrough too', async () => {
      const svc = await build();
      const honest = await zipOf({
        '.git/objects/pack/pack-1.pack': Buffer.alloc(8 * MIB),
      });
      const input = path.join(dir, 'liar-git.zip');
      await fs.promises.writeFile(input, lieAboutSizes(honest, 10));
      await expect((svc as any).filterZipFile(input, dir)).rejects.toThrow(
        ArchiveLimitError,
      );
    });

    it('streams the kept .git entries instead of buffering them whole', async () => {
      const svc = await build();
      const pack = Buffer.alloc(900 * 1024, 'p');
      const input = path.join(dir, 'git-stream.zip');
      await writeZip(input, {
        '.git/HEAD': 'ref: refs/heads/main\n',
        '.git/objects/pack/pack-1.pack': pack,
        '.git/config': '[core]\n\tfsmonitor = id\n',
      });
      const streamed = jest.spyOn(svc as any, 'appendEntryStream');
      const out = await (svc as any).filterZipFile(input, dir);
      const entries = await readZip(out);
      expect(streamed.mock.calls.map((c) => c[2]).sort()).toEqual([
        '.git/HEAD',
        '.git/objects/pack/pack-1.pack',
      ]);
      expect(entries['.git/objects/pack/pack-1.pack'].equals(pack)).toBe(true);
      expect(entries['.git/config'].toString()).toBe(
        '[core]\n\trepositoryformatversion = 0\n\tbare = false\n',
      );
    });

    it('skips a dropped .git entry without inflating it', async () => {
      const svc = await build();
      const honest = await zipOf({
        '.git/HEAD': 'ref: refs/heads/main\n',
        '.git/hooks/pre-commit': Buffer.alloc(8 * MIB),
        'sub/.git/objects/pack/pack-2.pack': Buffer.alloc(8 * MIB),
      });
      const input = path.join(dir, 'liar-dropped-git.zip');
      await fs.promises.writeFile(input, lieAboutSizes(honest, 10));
      const out = await (svc as any).filterZipFile(input, dir);
      expect(Object.keys(await readZip(out)).sort()).toEqual([
        '.git/HEAD',
        '.git/config',
      ]);
    });

    it('meters the uploaded git config it reads', async () => {
      const svc = await build();
      const honest = await zipOf({
        '.git/HEAD': 'ref: refs/heads/main\n',
        '.git/config': Buffer.alloc(8 * MIB, '#'),
      });
      const input = path.join(dir, 'liar-git-config.zip');
      await fs.promises.writeFile(input, lieAboutSizes(honest, 10));
      await expect((svc as any).filterZipFile(input, dir)).rejects.toThrow(
        ArchiveLimitError,
      );
    });

    it('aborts once the entries read add up past the total limit although each declares 10 bytes', async () => {
      const svc = await build();
      const honest = await zipOf({
        'a.ts': Buffer.alloc(900 * 1024),
        'b.ts': Buffer.alloc(900 * 1024),
        'c.ts': Buffer.alloc(900 * 1024),
        'd.ts': Buffer.alloc(900 * 1024),
      });
      const input = path.join(dir, 'liar-total.zip');
      await fs.promises.writeFile(input, lieAboutSizes(honest, 10));
      await expect((svc as any).filterZipFile(input, dir)).rejects.toThrow(
        /total limit/,
      );
    });
  });

  describe('processUploadedFile', () => {
    it('scans a normal archive as before', async () => {
      const svc = await build();
      const sends = serve(
        svc,
        await zipOf({ 'src/app.ts': 'export const x = 1;\n' }),
      );
      await expect(svc.processUploadedFile(record('ok'))).resolves.toBe(true);
      expect(startScan).toHaveBeenCalledTimes(1);
      expect(updateScanData).not.toHaveBeenCalled();
      const put = sends.find((c) => c.constructor.name === 'PutObjectCommand');
      expect(put.input.Key).toBe('filtered/p/ok.zip');
    });

    // The filtered archive used to be read whole into a Buffer before the
    // upload: hundreds of MB on top of the filter's own memory. It now goes
    // as a stream of its file, and the original archive is already removed
    // from disk by then.
    it('uploads the filtered archive as a stream of its file, once the original is removed', async () => {
      const svc = await build();
      const sends = serve(
        svc,
        await zipOf({ 'src/app.ts': 'export const x = 1;\n' }),
      );
      const send = (svc as any).s3Client.send as jest.Mock;
      const base = send.getMockImplementation()!;
      let size: number | undefined;
      let originalLeft: boolean | undefined;
      send.mockImplementation(async (cmd: any) => {
        const body = cmd.input?.Body;
        if (
          cmd.constructor.name === 'PutObjectCommand' &&
          body instanceof fs.ReadStream
        ) {
          size = fs.statSync(body.path as string).size;
          originalLeft = fs.existsSync(
            path.join(path.dirname(body.path as string), 'original.zip'),
          );
        }
        return base(cmd);
      });

      await expect(svc.processUploadedFile(record('streamup'))).resolves.toBe(
        true,
      );

      const put = sends.find((c) => c.constructor.name === 'PutObjectCommand');
      expect(put.input.Body).toBeInstanceOf(fs.ReadStream);
      expect(put.input.ContentLength).toBe(size);
      expect(originalLeft).toBe(false);
    });

    // A stream cannot be sent twice, so the SDK's own retries no longer cover
    // the upload: a failed attempt is retried with a fresh stream of the file.
    it('retries a failed upload of the filtered archive with a fresh stream', async () => {
      const svc = await build({ FILE_UPLOAD_RETRY_DELAY_MS: 0 });
      const sends = serve(
        svc,
        await zipOf({ 'src/app.ts': 'export const x = 1;\n' }),
      );
      const send = (svc as any).s3Client.send as jest.Mock;
      const base = send.getMockImplementation()!;
      let puts = 0;
      send.mockImplementation(async (cmd: any) => {
        if (cmd.constructor.name === 'PutObjectCommand' && puts++ === 0) {
          sends.push(cmd);
          throw new Error('socket hang up');
        }
        return base(cmd);
      });

      await expect(svc.processUploadedFile(record('retryup'))).resolves.toBe(
        true,
      );

      const putCmds = sends.filter(
        (c) => c.constructor.name === 'PutObjectCommand',
      );
      expect(putCmds).toHaveLength(2);
      expect(putCmds[1].input.Body).not.toBe(putCmds[0].input.Body);
      expect(startScan).toHaveBeenCalledTimes(1);
    });

    it('fails the scan of a small archive declaring an entry past the entry limit', async () => {
      const svc = await build();
      const bomb = await zipOf({ 'src/bomb.ts': Buffer.alloc(16 * MIB) });
      expect(bomb.length).toBeLessThan(64 * 1024);
      const sends = serve(svc, bomb);
      await expect(svc.processUploadedFile(record('bomb'))).resolves.toBe(
        false,
      );
      expectRejected(sends, 'bomb', 'ARCHIVE_ENTRY_TOO_LARGE', /entry limit/);
    });

    it('fails the scan of an archive whose declared sizes add up past the total limit', async () => {
      const svc = await build();
      const sends = serve(
        svc,
        await zipOf({
          'a.ts': Buffer.alloc(900 * 1024),
          'b.ts': Buffer.alloc(900 * 1024),
          'c.ts': Buffer.alloc(900 * 1024),
          'd.ts': Buffer.alloc(900 * 1024),
        }),
      );
      await expect(svc.processUploadedFile(record('total'))).resolves.toBe(
        false,
      );
      expectRejected(
        sends,
        'total',
        'ARCHIVE_INFLATED_TOO_LARGE',
        /uncompressed exceeds/,
      );
    });

    it('fails the scan of an archive holding more entries than the limit', async () => {
      const svc = await build();
      const entries: Record<string, string> = {};
      for (let i = 0; i < 21; i++) entries[`src/f${i}.ts`] = 'x';
      const sends = serve(svc, await zipOf(entries));
      await expect(svc.processUploadedFile(record('count'))).resolves.toBe(
        false,
      );
      expectRejected(
        sends,
        'count',
        'ARCHIVE_TOO_MANY_ENTRIES',
        /more than 20 entries/,
      );
    });

    it('fails the scan of an archive lying about its sizes, with the limit named', async () => {
      const svc = await build();
      const honest = await zipOf({ 'src/liar.ts': Buffer.alloc(8 * MIB) });
      const sends = serve(svc, lieAboutSizes(honest, 10));
      await expect(svc.processUploadedFile(record('liar'))).resolves.toBe(
        false,
      );
      expectRejected(sends, 'liar', 'ARCHIVE_ENTRY_TOO_LARGE', /inflates past/);
    });

    it('refuses an S3 object larger than the archive limit before downloading it', async () => {
      const svc = await build();
      const zip = await zipOf({ 'src/app.ts': 'x' });
      const sends = serve(svc, zip, 3 * MIB);
      await expect(svc.processUploadedFile(record('huge'))).resolves.toBe(
        false,
      );
      expectRejected(
        sends,
        'huge',
        'ARCHIVE_TOO_LARGE',
        /3\.00 MiB.*2\.00 MiB limit/,
      );
      expectDeleted(sends, 'huge');
    });

    it('stops downloading an S3 object that streams past the archive limit', async () => {
      const svc = await build({ FULL_SCAN_MAX_ARCHIVE_BYTES: 1024 });
      const zip = await zipOf({ 'src/app.ts': Buffer.alloc(4096, 'q') });
      // ContentLength absent: only the byte count can tell.
      const sends = serve(
        svc,
        Buffer.concat([zip, Buffer.alloc(8 * 1024)]),
        undefined,
      );
      await expect(svc.processUploadedFile(record('stream'))).resolves.toBe(
        false,
      );
      expectRejected(sends, 'stream', 'ARCHIVE_TOO_LARGE', /1\.00 KiB limit/);
      expectDeleted(sends, 'stream');
    });

    it('deletes the uploaded object of an archive refused on a limit', async () => {
      const svc = await build();
      const entries: Record<string, string> = {};
      for (let i = 0; i < 21; i++) entries[`src/f${i}.ts`] = 'x';
      const sends = serve(svc, await zipOf(entries));
      await svc.processUploadedFile(record('count2'));
      expectDeleted(sends, 'count2');
    });

    it('deletes the uploaded object of an archive that inflates past a limit while filtered', async () => {
      const svc = await build();
      const honest = await zipOf({ 'src/liar.ts': Buffer.alloc(8 * MIB) });
      const sends = serve(svc, lieAboutSizes(honest, 10));
      await svc.processUploadedFile(record('liar2'));
      expectDeleted(sends, 'liar2');
    });

    it('deletes the uploaded object of a file that is not a ZIP', async () => {
      const svc = await build();
      const sends = serve(svc, Buffer.from('this is not a zip archive at all'));
      await expect(svc.processUploadedFile(record('garbage'))).resolves.toBe(
        false,
      );
      expect(startScan).not.toHaveBeenCalled();
      expectDeleted(sends, 'garbage');
    });

    it('removes the upload even when the scan service cannot be told', async () => {
      const svc = await build();
      updateScanData.mockImplementation(() => {
        throw new Error('scan service unavailable');
      });
      const zip = await zipOf({ 'src/app.ts': 'x' });
      const sends = serve(svc, zip, 3 * MIB);
      await svc.processUploadedFile(record('down')).catch(() => false);
      expectDeleted(sends, 'down');
    });
  });

  // The Community Edition's scanner pods download the FILTERED archive and
  // refuse it past their own bounds: accepted here, it started every pod,
  // each of which exited, and the scan failed far from its cause. What is
  // forwarded is now held to those bounds, and refused with a code and the
  // limit named before any pod starts.
  describe('processUploadedFile, bounded by what the scanner pods accept', () => {
    const SCANNER = {
      maxArchiveBytes: 2 * MIB,
      maxEntries: 20,
      maxTotalBytes: 1.5 * MIB,
    };
    const withScannerLimits = (
      svc: FileService,
      limits: typeof SCANNER | null,
    ) => {
      (svc as any).scannerLimits = () => limits;
      return svc;
    };

    it('refuses an archive whose kept files unpack past the scanner limit, before any scan starts', async () => {
      const svc = withScannerLimits(await build(), SCANNER);
      const sends = serve(
        svc,
        await zipOf({
          'notes/a.txt': Buffer.alloc(900 * 1024, 'a'),
          'notes/b.txt': Buffer.alloc(900 * 1024, 'b'),
        }),
      );
      await expect(svc.processUploadedFile(record('pods'))).resolves.toBe(
        false,
      );
      expectRejected(sends, 'pods', 'ARCHIVE_INFLATED_TOO_LARGE', /1\.50 MiB/);
      expectDeleted(sends, 'pods');
    });

    it('counts only what is forwarded: dropped dependencies do not count', async () => {
      const svc = withScannerLimits(await build(), SCANNER);
      serve(
        svc,
        await zipOf({
          'src/app.ts': 'export const x = 1;\n',
          'node_modules/a/index.js': Buffer.alloc(900 * 1024, 'a'),
          'node_modules/b/index.js': Buffer.alloc(900 * 1024, 'b'),
        }),
      );
      await expect(svc.processUploadedFile(record('deps'))).resolves.toBe(true);
      expect(startScan).toHaveBeenCalledTimes(1);
    });

    it('refuses a filtered archive larger than the scanner download limit', async () => {
      const svc = withScannerLimits(await build(), {
        ...SCANNER,
        maxArchiveBytes: 512 * 1024,
      });
      // Random bytes do not compress: the filtered archive stays this large.
      const random = randomBytes(900 * 1024);
      const sends = serve(
        svc,
        await zipOf({ 'keys/blob.txt': random, 'src/app.ts': 'x' }),
      );
      await expect(svc.processUploadedFile(record('dl'))).resolves.toBe(false);
      expectRejected(sends, 'dl', 'ARCHIVE_TOO_LARGE', /512\.00 KiB/);
    }, 30_000);

    it('refuses more entries than the scanner pods accept', async () => {
      const svc = withScannerLimits(await build(), {
        ...SCANNER,
        maxEntries: 5,
      });
      const entries: Record<string, string> = {};
      for (let i = 0; i < 6; i++) entries[`src/f${i}.ts`] = 'x';
      const sends = serve(svc, await zipOf(entries));
      await expect(svc.processUploadedFile(record('few'))).resolves.toBe(false);
      expectRejected(
        sends,
        'few',
        'ARCHIVE_TOO_MANY_ENTRIES',
        /more than 5 entries/,
      );
    });

    // The pods refuse a download one byte past 2 GiB and accept 2 GiB: the
    // filtered archive's size is held to the same comparison.
    it.each([
      ['limit - 1', -1, true],
      ['limit', 0, true],
      ['limit + 1', 1, false],
    ])(
      'a filtered archive at the real download bound %s',
      async (_label, delta, accepted) => {
        const svc = await build();
        (svc as any).scannerLimits = () => COMMUNITY_SCANNER_ARCHIVE_LIMITS;
        const size =
          COMMUNITY_SCANNER_ARCHIVE_LIMITS.maxArchiveBytes + (delta as number);
        const stat = jest
          .spyOn(fs.promises, 'stat')
          .mockResolvedValue({ size } as fs.Stats);
        try {
          const check = (svc as any).assertForwardableSize('filtered.zip');
          if (accepted) await expect(check).resolves.toBeUndefined();
          else
            await expect(check).rejects.toMatchObject({
              code: 'ARCHIVE_TOO_LARGE',
            });
        } finally {
          stat.mockRestore();
        }
      },
    );

    it('keeps the upload limits alone where the scanners add no bound', async () => {
      const svc = withScannerLimits(await build(), null);
      serve(
        svc,
        await zipOf({
          'notes/a.txt': Buffer.alloc(900 * 1024, 'a'),
          'notes/b.txt': Buffer.alloc(900 * 1024, 'b'),
        }),
      );
      await expect(svc.processUploadedFile(record('cloud'))).resolves.toBe(
        true,
      );
    });
  });

  // An archive that cannot be scanned at all is refused like one past a
  // limit: its own code in the archive range, a message saying what is wrong
  // with it, and its upload removed. A valid but empty ZIP is not « an
  // invalid signature ».
  // One processing slot serves every upload: an archive that takes longer
  // than its deadline to read and rewrite is stopped and fails alone.
  describe('processUploadedFile, an archive past its processing deadline', () => {
    const SLOW = {
      FILE_SCAN_ARCHIVE_DEADLINE_MS: 50,
      FULL_SCAN_MAX_ARCHIVE_BYTES: 64 * MIB,
      FULL_SCAN_MAX_ENTRY_BYTES: 512 * MIB,
      FULL_SCAN_MAX_UNCOMPRESSED_BYTES: 1024 * MIB,
    };
    let slowZip: Buffer;

    /**
     * A deadline is this service's limit, not the archive's fault: the scan
     * fails as a processing error naming the time limit, with no archive
     * code, and nothing is reported as wrong with the upload.
     */
    const expectProcessingTimeout = (sends: any[], id: string) => {
      expect(startScan).not.toHaveBeenCalled();
      expect(sends.some((c) => c.constructor.name === 'PutObjectCommand')).toBe(
        false,
      );
      expect(repo.update).toHaveBeenCalledWith(
        { id },
        { status: FileStatus.FAILED },
      );
      expect(updateScanData).toHaveBeenCalledTimes(1);
      const call = (updateScanData.mock.calls[0] as unknown[])[0] as {
        state: string;
        errorMessage: string;
        errorCode?: number;
        errorCategory?: string;
      };
      expect(call.state).toBe('failed');
      expect(call.errorCode).toBeUndefined();
      expect(call.errorCategory).toBeUndefined();
      expect(call.errorMessage).toMatch(/took longer than/);
      expect(call.errorMessage).not.toMatch(/ARCHIVE_|too much|too large/);
    };

    beforeAll(async () => {
      const tmp = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'fms-slow-'),
      );
      const p = path.join(tmp, 'slow.zip');
      await writeZip(p, {
        'src/a.ts': Buffer.alloc(48 * MIB),
        'src/b.ts': Buffer.alloc(48 * MIB),
      });
      slowZip = await fs.promises.readFile(p);
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }, 120_000);

    it('stops filtering and fails that upload only, the next one processed', async () => {
      const svc = await build(SLOW);
      const sends = serve(svc, slowZip);
      await expect(svc.processUploadedFile(record('slow'))).resolves.toBe(
        false,
      );
      expectProcessingTimeout(sends, 'slow');

      serve(svc, await zipOf({ 'src/app.ts': 'export const x = 1;\n' }));
      const next = { ...record('next'), projectId: 'other-project' };
      next.objectPath = 'scan/other-project/next.zip';
      await expect(svc.processUploadedFile(next)).resolves.toBe(true);
    }, 120_000);

    it('aborts the rewrite through the filter itself', async () => {
      const svc = await build(SLOW);
      const input = path.join(dir, 'slow.zip');
      await fs.promises.writeFile(input, slowZip);
      await expect((svc as any).filterZipFile(input, dir)).rejects.toThrow(
        /took longer than/,
      );
    }, 120_000);

    // Past the deadline while the filtered archive is being finalised: the
    // writer never settles once aborted then, so the deadline must end the
    // filtering by itself, and the cleanup must still run.
    it('ends an archive whose finalisation never settles, and cleans up', async () => {
      const svc = await build({ FILE_SCAN_ARCHIVE_DEADLINE_MS: 200 });
      const sends = serve(
        svc,
        await zipOf({ 'src/a.ts': 'export const a = 1;\n' }),
      );
      const createWriter = (FileService.prototype as any).createArchiveWriter;
      const writer = jest
        .spyOn(svc as any, 'createArchiveWriter')
        .mockImplementation(() => {
          const real = createWriter.call(svc);
          real.finalize = () => new Promise<void>(() => undefined);
          return real;
        });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeFs = require('node:fs') as typeof fs;
      const realOpen = nodeFs.promises.open.bind(nodeFs.promises);
      let archiveCloses = 0;
      const open = jest
        .spyOn(nodeFs.promises, 'open')
        .mockImplementation(async (...args: Parameters<typeof realOpen>) => {
          const handle = await realOpen(...args);
          if (String(args[0]).endsWith('original.zip')) {
            const close = handle.close.bind(handle);
            handle.close = () => {
              archiveCloses++;
              return close();
            };
          }
          return handle;
        });
      const made: string[] = [];
      const realMkdir = nodeFs.promises.mkdir.bind(nodeFs.promises);
      const mkdir = jest
        .spyOn(nodeFs.promises, 'mkdir')
        .mockImplementation(
          async (...args: Parameters<typeof nodeFs.promises.mkdir>) => {
            made.push(String(args[0]));
            return realMkdir(...args);
          },
        );
      try {
        await expect(svc.processUploadedFile(record('stuck'))).resolves.toBe(
          false,
        );
      } finally {
        writer.mockRestore();
        open.mockRestore();
        mkdir.mockRestore();
      }
      expectProcessingTimeout(sends, 'stuck');
      // One open of the uploaded archive for its checks and its filter
      // (the signature read opens it once more): every handle closed once.
      await new Promise((r) => setTimeout(r, 20));
      expect(archiveCloses).toBe(2);
      expect(made).toHaveLength(1);
      expect(fs.existsSync(made[0])).toBe(false);

      updateScanData.mockClear();
      serve(svc, await zipOf({ 'src/app.ts': 'export const x = 1;\n' }));
      const next = { ...record('next'), projectId: 'other-project' };
      next.objectPath = 'scan/other-project/next.zip';
      await expect(svc.processUploadedFile(next)).resolves.toBe(true);
    }, 30_000);

    it('lets an archive through within the default deadline', async () => {
      const svc = await build({
        FULL_SCAN_MAX_ARCHIVE_BYTES: 64 * MIB,
        FULL_SCAN_MAX_ENTRY_BYTES: 512 * MIB,
        FULL_SCAN_MAX_UNCOMPRESSED_BYTES: 1024 * MIB,
      });
      const input = path.join(dir, 'slow-ok.zip');
      await fs.promises.writeFile(input, slowZip);
      await expect((svc as any).filterZipFile(input, dir)).resolves.toMatch(
        /filtered\.zip$/,
      );
    }, 120_000);
  });

  // A failure of this pod's file system (too many open files, no space, an
  // I/O error) says nothing of the archive: the upload is kept and processed
  // again by a later tick, and the customer is not told the archive is bad.
  describe('processUploadedFile, a file-system failure of this service', () => {
    const failOpens = (code: string) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeFs = require('node:fs') as typeof fs;
      const realOpen = nodeFs.promises.open.bind(nodeFs.promises);
      return jest
        .spyOn(nodeFs.promises, 'open')
        .mockImplementation(async (...args: Parameters<typeof realOpen>) => {
          if (String(args[0]).endsWith('original.zip')) {
            throw Object.assign(new Error(`${code}: open failed`), {
              code,
              errno: -24,
              syscall: 'open',
            });
          }
          return realOpen(...args);
        });
    };

    it.each(['EMFILE', 'ENOSPC', 'EIO'])(
      'puts the upload back for a retry after %s, without failing the scan',
      async (code) => {
        const svc = await build();
        const sends = serve(svc, await zipOf({ 'src/a.ts': 'x' }));
        const open = failOpens(code);
        try {
          await expect(svc.processUploadedFile(record('fs'))).resolves.toBe(
            false,
          );
        } finally {
          open.mockRestore();
        }
        expect(updateScanData).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(
          { id: 'fs' },
          expect.objectContaining({ status: FileStatus.PENDING_UPLOAD }),
        );
        expect(
          sends.some((c) => c.constructor.name === 'DeleteObjectCommand'),
        ).toBe(false);
      },
    );

    // While the archive is filtered: the usual place of a full disk is the
    // write of the filtered archive, and an I/O error can hit any read.
    const expectPutBack = (sends: any[], id: string) => {
      expect(updateScanData).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        { id },
        expect.objectContaining({ status: FileStatus.PENDING_UPLOAD }),
      );
      expect(repo.update).not.toHaveBeenCalledWith(
        { id },
        expect.objectContaining({ status: FileStatus.FAILED }),
      );
      expect(
        sends.some((c) => c.constructor.name === 'DeleteObjectCommand'),
      ).toBe(false);
    };

    it('puts the upload back after a full disk while writing the filtered archive', async () => {
      const svc = await build();
      const sends = serve(
        svc,
        await zipOf({ 'src/a.ts': 'export const a = 1;\n' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeFs = require('node:fs') as typeof fs;
      const realCreate = nodeFs.createWriteStream.bind(nodeFs);
      const create = jest
        .spyOn(nodeFs, 'createWriteStream')
        .mockImplementation(((target: fs.PathLike, options?: unknown) => {
          if (!String(target).endsWith('filtered.zip')) {
            return realCreate(target, options as never);
          }
          return new Writable({
            write(_chunk, _enc, cb) {
              cb(
                Object.assign(new Error('ENOSPC: no space left on device'), {
                  code: 'ENOSPC',
                  errno: -28,
                  syscall: 'write',
                }),
              );
            },
          });
        }) as typeof nodeFs.createWriteStream);
      try {
        await expect(svc.processUploadedFile(record('full'))).resolves.toBe(
          false,
        );
      } finally {
        create.mockRestore();
      }
      expectPutBack(sends, 'full');
    });

    it('puts the upload back after an I/O error while reading an entry', async () => {
      const svc = await build();
      // Incompressible, so the entry's data is read in large chunks.
      const sends = serve(
        svc,
        await zipOf({ 'src/data.ts': randomBytes(200 * 1024) }),
      );
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeFs = require('node:fs') as typeof fs;
      const realOpen = nodeFs.promises.open.bind(nodeFs.promises);
      const open = jest
        .spyOn(nodeFs.promises, 'open')
        .mockImplementation(async (...args: Parameters<typeof realOpen>) => {
          const handle = await realOpen(...args);
          if (!String(args[0]).endsWith('original.zip')) return handle;
          const read = handle.read.bind(handle) as (
            ...a: unknown[]
          ) => Promise<{ bytesRead: number; buffer: Buffer }>;
          // The checks read headers (small) and the end of the file; the
          // filter reads the entry's data from the start, in large chunks.
          handle.read = ((...a: unknown[]) => {
            const [, , length, position] = a as [
              Buffer,
              number,
              number,
              number,
            ];
            if (length >= 16 * 1024 && position < 4096) {
              return Promise.reject(
                Object.assign(new Error('EIO: i/o error, read'), {
                  code: 'EIO',
                  errno: -5,
                  syscall: 'read',
                }),
              );
            }
            return read(...a);
          }) as typeof handle.read;
          return handle;
        });
      try {
        await expect(svc.processUploadedFile(record('eio'))).resolves.toBe(
          false,
        );
      } finally {
        open.mockRestore();
      }
      expectPutBack(sends, 'eio');
    });

    it('fails the scan as a processing error once the retries are spent', async () => {
      const svc = await build();
      const open = failOpens('EMFILE');
      try {
        for (let i = 0; i < 10; i++) {
          serve(svc, await zipOf({ 'src/a.ts': 'x' }));
          await svc.processUploadedFile(record('fs'));
          if (updateScanData.mock.calls.length > 0) break;
        }
      } finally {
        open.mockRestore();
      }
      expect(updateScanData).toHaveBeenCalledTimes(1);
      const call = (updateScanData.mock.calls[0] as unknown[])[0] as {
        state: string;
        errorMessage: string;
        errorCategory?: string;
      };
      expect(call.state).toBe('failed');
      expect(call.errorCategory).toBeUndefined();
      expect(call.errorMessage).not.toMatch(/not a ZIP/);
    });
  });

  describe('processUploadedFile, an archive that reads as more than one archive', () => {
    const visible = [{ name: 'README.md', data: 'hello\n' }];
    const hidden = [
      { name: 'hidden/payload.py', data: 'import os\nos.system("id")\n' },
    ];

    /**
     * The refusal fails that upload only: the next upload, of another
     * project, is filtered and its scan started by the same service.
     */
    const expectNextUploadProcessed = async (svc: FileService) => {
      serve(svc, await zipOf({ 'src/app.ts': 'export const x = 1;\n' }));
      const next = { ...record('next'), projectId: 'other-project' };
      next.objectPath = 'scan/other-project/next.zip';
      await expect(svc.processUploadedFile(next)).resolves.toBe(true);
      expect(startScan).toHaveBeenCalledTimes(1);
    };

    it.each([
      [
        'two end records, each with its own central directory',
        () => twoEndRecordsZip(visible, hidden),
        /more than one end-of-central-directory record/,
      ],
      [
        'two end records, the first one past the entry limit',
        () => twoEndRecordsZip(visible, hidden, 500),
        /more than one end-of-central-directory record/,
      ],
      [
        'an end record hidden in a central directory record',
        () => endRecordInDirectoryZip(visible, hidden),
        /does not account for/,
      ],
      [
        'an end record held as the comment of the end record',
        () => endRecordInCommentZip(visible),
        /more than one end-of-central-directory record/,
      ],
      [
        'central directory records that all point at the same data',
        () => overlappingRecordsZip({ name: 'a.py', data: 'x = 1\n' }, 10),
        /does not account for/,
      ],
      [
        'bytes between the entries and the central directory',
        () => unaccountedDataZip(visible, craftZip(hidden)),
        /does not account for/,
      ],
    ])('refuses %s', async (_label, make, pattern) => {
      const svc = await build();
      const sends = serve(svc, make());
      await expect(svc.processUploadedFile(record('twice'))).resolves.toBe(
        false,
      );
      expectRejected(sends, 'twice', 'ARCHIVE_INVALID', pattern);
      expectDeleted(sends, 'twice');
      await expectNextUploadProcessed(svc);
    });

    it('filters what it checked: the filter refuses such an archive too', async () => {
      const svc = await build();
      const input = path.join(dir, 'two-ends.zip');
      await fs.promises.writeFile(input, twoEndRecordsZip(visible, hidden));
      await expect((svc as any).filterZipFile(input, dir)).rejects.toThrow(
        /more than one end-of-central-directory record/,
      );
    });

    it('still accepts a well-formed archive written byte for byte', async () => {
      const svc = await build();
      serve(
        svc,
        craftZip([
          { name: 'src/a.py', data: 'a = 1\n' },
          { name: 'src/b.py', data: 'b = 2\n'.repeat(100), deflate: true },
        ]),
      );
      await expect(svc.processUploadedFile(record('crafted'))).resolves.toBe(
        true,
      );
      expect(startScan).toHaveBeenCalledTimes(1);
    });
  });

  describe('processUploadedFile, an archive that cannot be scanned', () => {
    // A real encrypted ZIP (zip -e), one entry "secret.txt".
    const ENCRYPTED_ZIP = Buffer.from(
      'UEsDBAoACQAAAJxxqlwtOwivGAAAAAwAAAAKABwAc2VjcmV0LnR4dFVUCQADR3YA' +
        'akd2AGp1eAsAAQT1AQAABAAAAAAfZPni7n3Z0rireKxZ+djiZAsd3dRCH9RQSwcI' +
        'LTsIrxgAAAAMAAAAUEsBAh4DCgAJAAAAnHGqXC07CK8YAAAADAAAAAoAGAAAAAAA' +
        'AQAAAKSBAAAAAHNlY3JldC50eHRVVAUAA0d2AGp1eAsAAQT1AQAABAAAAABQSwUG' +
        'AAAAAAEAAQBQAAAAbAAAAAAA',
      'base64',
    );
    /** The end-of-central-directory record alone: a valid ZIP of nothing. */
    const EMPTY_ZIP = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x05, 0x06]),
      Buffer.alloc(18),
    ]);
    /** Rename an entry in place (same length) in every header of `zip`. */
    const renamed = (zip: Buffer, from: string, to: string): Buffer => {
      expect(to.length).toBe(from.length);
      return Buffer.from(zip.toString('latin1').split(from).join(to), 'latin1');
    };

    it.each([
      ['a plain file', () => Buffer.from('print("not a zip")\n')],
      ['a gzip archive', () => Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0])],
    ])('refuses %s as not a ZIP archive', async (_label, make) => {
      const svc = await build();
      const sends = serve(svc, make());
      await expect(svc.processUploadedFile(record('notzip'))).resolves.toBe(
        false,
      );
      expectRejected(sends, 'notzip', 'ARCHIVE_INVALID', /not a ZIP archive/);
      expectDeleted(sends, 'notzip');
    });

    it('refuses a valid ZIP that holds no file as empty, not as an invalid signature', async () => {
      const svc = await build();
      const sends = serve(svc, EMPTY_ZIP);
      await expect(svc.processUploadedFile(record('empty'))).resolves.toBe(
        false,
      );
      expectRejected(sends, 'empty', 'ARCHIVE_EMPTY', /holds no file/);
    });

    it('refuses a ZIP of empty folders as empty', async () => {
      const svc = await build();
      const zip = await zipOf({ 'keep/.gitkeep': '' });
      const sends = serve(svc, renamed(zip, 'keep/.gitkeep', 'keep/inner/x/'));
      await expect(svc.processUploadedFile(record('dirs'))).resolves.toBe(
        false,
      );
      expectRejected(sends, 'dirs', 'ARCHIVE_EMPTY', /holds no file/);
    });

    it('refuses a password-protected archive, naming the entry', async () => {
      const svc = await build();
      const sends = serve(svc, ENCRYPTED_ZIP);
      await expect(svc.processUploadedFile(record('enc'))).resolves.toBe(false);
      expectRejected(
        sends,
        'enc',
        'ARCHIVE_ENCRYPTED',
        /password-protected.*secret\.txt/,
      );
    });

    it.each([
      ['a ../ path', 'aa/aa/evil.py', '../../evil.py'],
      ['an absolute path', 'zabs/evil2.py', '/abs/evil2.py'],
    ])('refuses an entry with %s', async (_label, from, to) => {
      const svc = await build();
      const zip = await zipOf({ [from]: 'x = 1\n', 'src/app.py': 'y = 2\n' });
      const sends = serve(svc, renamed(zip, from, to));
      await expect(svc.processUploadedFile(record('path'))).resolves.toBe(
        false,
      );
      expectRejected(
        sends,
        'path',
        'ARCHIVE_UNSAFE_PATH',
        new RegExp(`leaves the archive.*${to.replace(/[./]/g, '\\$&')}`),
      );
    });
  });
});
