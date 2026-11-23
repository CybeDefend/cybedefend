import 'reflect-metadata';
import { Logger as NestLogger } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { Observable, of, throwError } from 'rxjs';
import { validate as uuidValidate, version as uuidVersion } from 'uuid';

import { FILE_SERVICE_NAME } from '@grpc/file-management/file_management';
import { SCAN_SERVICE_NAME } from '@grpc/security-scanning/security_scanning';
import { GlobalExceptionFilter } from 'src/core/exceptions';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { registerMultipart } from 'src/core/http/register-multipart';
import { ScanService } from '../scan.service';
import { ScanImportController } from './scan-import.controller';
import {
  IMPORT_MAX_IN_FLIGHT_PER_POD,
  ScanImportService,
} from './scan-import.service';

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const URL_PATH = `/project/${PROJECT}/scan/import/start`;
const UPLOAD_URL =
  'http://minio:9000/bucket/import/aaaa.sarif?X-Amz-Signature=deadbeefsecret';
const SARIF = Buffer.from('{"version":"2.1.0","runs":[]}');

type Part =
  | { name: string; value: string }
  | { name: string; filename: string; content: Buffer };

/** A multipart/form-data body, parts in the order given. */
function multipart(parts: Part[]): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const boundary = '----cybedefendtestboundary7MA4YWxkTrZu0gW';
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if ('filename' in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            'Content-Type: application/octet-stream\r\n\r\n',
        ),
      );
      chunks.push(part.content);
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}`,
        ),
      );
    }
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const file = (content: Buffer = SARIF, filename = 'results.sarif'): Part => ({
  name: 'file',
  filename,
  content,
});
const field = (name: string, value: string): Part => ({ name, value });

type Req = Record<string, unknown>;
/** A fake unary gRPC method: (request, metadata) => Observable. */
const rpc = (value: unknown) =>
  jest.fn((_req: Req, _metadata?: unknown): Observable<unknown> => of(value));
/** What a gRPC method rejects with: a grpc-js ServiceError's shape. */
const grpcError = (code: number, details: string): Observable<unknown> =>
  throwError(() => ({ code, details }));

describe('POST /project/:projectId/scan/import/start (ScanImportController)', () => {
  let app: NestFastifyApplication;
  const savedEdition = process.env.CYBEDEFEND_EDITION;

  const permission = { canActivate: jest.fn(async () => true) };
  const scanClient = {
    createScan: rpc({ success: true, message: '' }),
    startScan: rpc({ success: true, message: 'started' }),
    cancelScan: rpc({ success: true, message: 'cancelled' }),
    checkExistingScan: rpc({}),
  };
  const fileClient = {
    requestImportUploadUrl: rpc({
      uploadUrl: UPLOAD_URL,
      objectKey: `import/${PROJECT}/key.sarif`,
      uploadExpiresAtMs: '1790000000000',
      uploadHeaders: { 'x-test': '1' },
    }),
    deleteImportObject: rpc({ success: true }),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };
  let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;
  const realFetch = global.fetch;

  const post = (parts: Part[], headers: Record<string, string> = {}) => {
    const body = multipart(parts);
    return app.inject({
      method: 'POST',
      url: URL_PATH,
      payload: body.payload,
      headers: { ...body.headers, ...headers },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ScanImportController],
      providers: [
        ScanService,
        ScanImportService,
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: (name: string) =>
              name === SCAN_SERVICE_NAME ? scanClient : undefined,
          },
        },
        {
          provide: 'FILE_MANAGEMENT_SERVICE',
          useValue: {
            getService: (name: string) =>
              name === FILE_SERVICE_NAME ? fileClient : undefined,
          },
        },
        { provide: Logger, useValue: logger },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => { user?: unknown } };
        }) => {
          ctx.switchToHttp().getRequest().user = { sub: 'u1' };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue(permission)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    await registerMultipart(app);
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    // The import is a Community Edition feature; the cloud edition tests
    // its refusal.
    process.env.CYBEDEFEND_EDITION = 'community';
  });

  afterEach(() => {
    if (savedEdition === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = savedEdition;
  });

  const nothingStored = () => {
    expect(fileClient.requestImportUploadUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(scanClient.createScan).not.toHaveBeenCalled();
    expect(scanClient.startScan).not.toHaveBeenCalled();
  };

  it('answers 202 with the scan id and creates an import scan', async () => {
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
    ]);

    expect(res.statusCode).toBe(202);
    const { scanId } = res.json();
    expect(res.json()).toEqual({ scanId });
    expect(scanClient.createScan).toHaveBeenCalledTimes(1);
    const created = scanClient.createScan.mock.calls[0][0];
    expect(created).toEqual(
      expect.objectContaining({
        scanId,
        projectId: PROJECT,
        initializerUserId: 'u1',
        privateScan: false,
        vulnerabilityTypes: [],
        branch: 'main',
        sourceType: 'manual',
        importFormat: 'sarif',
        importType: 'sast',
      }),
    );
    expect('commit' in created).toBe(false);
    expect('importTool' in created).toBe(false);
    expect(scanClient.startScan.mock.calls[0][0]).toEqual({
      scanId,
      projectId: PROJECT,
      branch: 'main',
      language: [],
    });
  });

  it('sends no importImage for any other type', async () => {
    await post([field('type', 'iac'), field('branch', 'main'), file()]);
    expect('importImage' in scanClient.createScan.mock.calls[0][0]).toBe(false);
  });

  it('marks a scan sent by the CLI as cli', async () => {
    await post([field('type', 'sast'), field('branch', 'main'), file()], {
      'user-agent': 'cybedefend-cli/1.2.0',
    });
    expect(scanClient.createScan.mock.calls[0][0].sourceType).toBe('cli');
  });

  it('reads no part when the permission check fails', async () => {
    permission.canActivate.mockResolvedValueOnce(false);
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
    ]);
    expect(res.statusCode).toBe(403);
    nothingStored();
  });

  it('refuses a project id that is not a UUID before reading anything', async () => {
    const body = multipart([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/project/not-a-uuid/scan/import/start',
      payload: body.payload,
      headers: body.headers,
    });
    expect(res.statusCode).toBe(400);
    nothingStored();
  });

  it('passes the image to CreateScan for a container import', async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    const res = await post([
      field('type', 'container'),
      field('branch', 'main'),
      field('image', 'ghcr.io/example/api:2.0.1'),
      file(),
    ]);
    expect(res.statusCode).toBe(202);
    expect(scanClient.createScan).toHaveBeenCalledWith(
      expect.objectContaining({
        importType: 'container',
        importImage: 'ghcr.io/example/api:2.0.1',
      }),
      expect.anything(),
    );
  });

  it('answers 400 IMPORT_IMAGE_REQUIRED and IMPORT_IMAGE_INVALID before any upload', async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    const required = await post([
      field('type', 'container'),
      field('branch', 'main'),
      file(),
    ]);
    expect(required.statusCode).toBe(400);
    expect(required.json().code).toBe('IMPORT_IMAGE_REQUIRED');
    const invalid = await post([
      field('type', 'container'),
      field('branch', 'main'),
      field('image', 'Alpine'),
      file(),
    ]);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('IMPORT_IMAGE_INVALID');
    nothingStored();
  });

  it('accepts an import with all five fields', async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    const res = await post([
      field('type', 'container'),
      field('branch', 'main'),
      field('commit', 'abcdef1234567'),
      field('format', 'sarif'),
      field('image', 'alpine:3.18'),
      file(),
    ]);
    expect(res.statusCode).toBe(202);
  });

  it('answers 400 IMPORT_INVALID_REQUEST for a sixth field', async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    const res = await post([
      field('type', 'container'),
      field('branch', 'main'),
      field('commit', 'abcdef1234567'),
      field('format', 'sarif'),
      field('image', 'alpine:3.18'),
      field('extra', '1'),
      file(),
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
    nothingStored();
  });

  it('answers 400 IMPORT_INVALID_REQUEST for an unknown or repeated field', async () => {
    for (const parts of [
      [field('type', 'sast'), field('branch', 'main'), field('x', '1'), file()],
      [
        field('type', 'sast'),
        field('type', 'iac'),
        field('branch', 'main'),
        file(),
      ],
    ]) {
      const res = await post(parts);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
    }
    nothingStored();
  });

  it('answers 400 IMPORT_INVALID_REQUEST for a field over 1 KiB', async () => {
    const res = await post([
      field('type', 'sast'),
      field('branch', 'a'.repeat(1025)),
      file(),
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
    nothingStored();
  });

  it('answers 400 IMPORT_INVALID_REQUEST for a file part under another name', async () => {
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      { name: 'upload', filename: 'results.sarif', content: SARIF },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
    nothingStored();
  });

  it('answers 400 IMPORT_INVALID_REQUEST for a body that is not multipart', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      payload: { type: 'sast', branch: 'main' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
    nothingStored();
  });

  it('accepts the file before the fields', async () => {
    const res = await post([
      file(),
      field('type', 'sast'),
      field('branch', 'main'),
    ]);
    expect(res.statusCode).toBe(202);
  });

  it('answers the file and SARIF refusals before any upload', async () => {
    const txt = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(SARIF, 'results.txt'),
    ]);
    expect(txt.statusCode).toBe(400);
    expect(txt.json().code).toBe('IMPORT_UNSUPPORTED_FILE');
    const notSarif = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(Buffer.from('<xml/>')),
    ]);
    expect(notSarif.statusCode).toBe(400);
    expect(notSarif.json().code).toBe('IMPORT_INVALID_SARIF');
    const empty = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(Buffer.alloc(0)),
    ]);
    expect(empty.statusCode).toBe(400);
    expect(empty.json().code).toBe('IMPORT_INVALID_SARIF');
    const format = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      field('format', 'cyclonedx'),
      file(),
    ]);
    expect(format.statusCode).toBe(400);
    expect(format.json().code).toBe('IMPORT_UNSUPPORTED_FORMAT');
    nothingStored();
  });

  it('creates the scan only after the file is stored', async () => {
    await post([field('type', 'sast'), field('branch', 'main'), file()]);
    const order = [
      fileClient.requestImportUploadUrl.mock.invocationCallOrder[0],
      fetchMock.mock.invocationCallOrder[0],
      scanClient.createScan.mock.invocationCallOrder[0],
      scanClient.startScan.mock.invocationCallOrder[0],
    ];
    expect(order.every((n) => typeof n === 'number')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('generates the scan id before the upload and keys the object with it', async () => {
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
    ]);
    const scanId = fileClient.requestImportUploadUrl.mock.calls[0][0]
      .scanId as string;
    expect(uuidValidate(scanId)).toBe(true);
    expect(uuidVersion(scanId)).toBe(6);
    expect(scanClient.createScan.mock.calls[0][0].scanId).toBe(scanId);
    expect(scanClient.startScan.mock.calls[0][0].scanId).toBe(scanId);
    expect(res.json()).toEqual({ scanId });
  });

  it('deletes the stored file when CreateScan fails', async () => {
    scanClient.createScan.mockReturnValueOnce(
      grpcError(GrpcStatus.INVALID_ARGUMENT, 'IMPORT_BRANCH_TOO_LONG'),
    );
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('IMPORT_BRANCH_TOO_LONG');
    expect(fileClient.deleteImportObject).toHaveBeenCalledTimes(1);
    expect(fileClient.deleteImportObject.mock.calls[0][0]).toEqual({
      projectId: PROJECT,
      objectKey: `import/${PROJECT}/key.sarif`,
    });
    expect(scanClient.startScan).not.toHaveBeenCalled();
  });

  it('keeps the CreateScan refusal when deleting the stored file fails', async () => {
    scanClient.createScan.mockReturnValueOnce(
      grpcError(GrpcStatus.INVALID_ARGUMENT, 'IMPORT_BRANCH_TOO_LONG'),
    );
    fileClient.deleteImportObject.mockReturnValueOnce(
      grpcError(GrpcStatus.UNAVAILABLE, 'down'),
    );
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('IMPORT_BRANCH_TOO_LONG');
    expect(scanClient.startScan).not.toHaveBeenCalled();
  });

  it('asks for an upload URL with the encoding and the length', async () => {
    const gz = Buffer.concat([
      Buffer.from([0x1f, 0x8b]),
      Buffer.alloc(15, 0x01),
    ]);
    expect(gz.length).toBe(17);
    await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(gz, 'results.sarif.gz'),
    ]);
    const scanId = scanClient.createScan.mock.calls[0][0].scanId;
    expect(fileClient.requestImportUploadUrl.mock.calls[0][0]).toEqual({
      scanId,
      projectId: PROJECT,
      contentEncoding: 'gzip',
      contentLength: 17,
    });
  });

  it('asks for identity on a plain file', async () => {
    await post([field('type', 'sast'), field('branch', 'main'), file()]);
    expect(
      fileClient.requestImportUploadUrl.mock.calls[0][0].contentEncoding,
    ).toBe('identity');
  });

  it('uploads the bytes with the signed headers and their length', async () => {
    const body = Buffer.from('{"runs":[],"x":1}');
    expect(body.length).toBe(17);
    await post([field('type', 'sast'), field('branch', 'main'), file(body)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(UPLOAD_URL);
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'x-test': '1', 'Content-Length': '17' });
    expect(Buffer.from(init.body as Uint8Array).equals(body)).toBe(true);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('never checks for a running scan', async () => {
    await post([field('type', 'sast'), field('branch', 'main'), file()]);
    expect(scanClient.checkExistingScan).not.toHaveBeenCalled();
  });

  it('answers 413 IMPORT_UPLOAD_TOO_LARGE above 50 MiB', async () => {
    const big = Buffer.alloc(52_428_801, 0x20);
    big[0] = 0x7b;
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(big),
    ]);
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('IMPORT_UPLOAD_TOO_LARGE');
    nothingStored();
  });

  it('accepts a file of exactly 50 MiB', async () => {
    const max = Buffer.alloc(52_428_800, 0x20);
    max[0] = 0x7b;
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(max),
    ]);
    expect(res.statusCode).toBe(202);
    expect(
      fileClient.requestImportUploadUrl.mock.calls[0][0].contentLength,
    ).toBe(52_428_800);
  });

  it('answers 400 IMPORT_INVALID_REQUEST without a file part, and with two file parts', async () => {
    const none = await post([field('type', 'sast'), field('branch', 'main')]);
    expect(none.statusCode).toBe(400);
    expect(none.json().code).toBe('IMPORT_INVALID_REQUEST');
    const two = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
      file(),
    ]);
    expect(two.statusCode).toBe(400);
    expect(two.json().code).toBe('IMPORT_INVALID_REQUEST');
    nothingStored();
  });

  it('answers 503 IMPORT_STORAGE_UNAVAILABLE when the upload fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
    ]);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('IMPORT_STORAGE_UNAVAILABLE');
    expect(scanClient.createScan).not.toHaveBeenCalled();
  });

  it('answers 503 IMPORT_STORAGE_UNAVAILABLE when the upload URL cannot be had', async () => {
    fileClient.requestImportUploadUrl.mockReturnValueOnce(
      grpcError(GrpcStatus.UNAVAILABLE, 'IMPORT_STORAGE_UNAVAILABLE'),
    );
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
    ]);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('IMPORT_STORAGE_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(scanClient.createScan).not.toHaveBeenCalled();
  });

  it('answers 503 IMPORT_UNAVAILABLE without cancelling when StartScan failed the scan', async () => {
    scanClient.startScan.mockReturnValueOnce(
      grpcError(GrpcStatus.UNAVAILABLE, 'IMPORT_UNAVAILABLE'),
    );
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
    ]);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('IMPORT_UNAVAILABLE');
    expect(scanClient.cancelScan).not.toHaveBeenCalled();
  });

  it('cancels a scan StartScan refused before it started', async () => {
    scanClient.startScan.mockReturnValueOnce(
      grpcError(GrpcStatus.PERMISSION_DENIED, 'WRITES_BLOCKED'),
    );
    const res = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
    ]);
    expect(res.statusCode).toBe(403);
    const scanId = scanClient.createScan.mock.calls[0][0].scanId;
    expect(scanClient.cancelScan).toHaveBeenCalledTimes(1);
    expect(scanClient.cancelScan.mock.calls[0][0]).toEqual({
      scanId,
      projectId: PROJECT,
    });
  });

  it('answers 503 IMPORT_BUSY when four imports are in flight', async () => {
    expect(IMPORT_MAX_IN_FLIGHT_PER_POD).toBe(4);
    const pending: Array<(r: Response) => void> = [];
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => pending.push(resolve)),
    );
    const parts = [field('type', 'sast'), field('branch', 'main'), file()];
    const inFlight = Array.from({ length: 4 }, () => post(parts));
    for (let i = 0; i < 200 && pending.length < 4; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(pending).toHaveLength(4);

    const fifth = await post(parts);
    expect(fifth.statusCode).toBe(503);
    expect(fifth.json().code).toBe('IMPORT_BUSY');
    expect(fifth.headers['retry-after']).toBe('15');

    pending.forEach((resolve) => resolve(new Response(null, { status: 200 })));
    const done = await Promise.all(inFlight);
    expect(done.map((r) => r.statusCode)).toEqual([202, 202, 202, 202]);

    // The slots are given back: the next import is served.
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 200 }),
    );
    expect((await post(parts)).statusCode).toBe(202);
  });

  it('gives the slot back after a refusal', async () => {
    const bad = [field('type', 'nope'), field('branch', 'main'), file()];
    for (let i = 0; i < IMPORT_MAX_IN_FLIGHT_PER_POD + 1; i++) {
      expect((await post(bad)).statusCode).toBe(400);
    }
    const ok = await post([
      field('type', 'sast'),
      field('branch', 'main'),
      file(),
    ]);
    expect(ok.statusCode).toBe(202);
  });

  describe('the CycloneDX SBOM of an sca import', () => {
    const SBOM = Buffer.from('{"bomFormat":"CycloneDX","specVersion":"1.6"}');
    const sbom = (content: Buffer = SBOM, filename = 'bom.cdx.json'): Part => ({
      name: 'sbom',
      filename,
      content,
    });
    const defaultUpload =
      fileClient.requestImportUploadUrl.getMockImplementation();

    beforeEach(() => {
      process.env.CYBEDEFEND_EDITION = 'community';
      fileClient.requestImportUploadUrl.mockImplementation((req: Req) =>
        of({
          uploadUrl: UPLOAD_URL,
          objectKey: `import/${PROJECT}/key.${req.kind === 'sbom' ? 'sbom' : 'sarif'}`,
          uploadExpiresAtMs: '1790000000000',
          uploadHeaders: { 'x-test': '1' },
        }),
      );
    });

    afterEach(() => {
      fileClient.requestImportUploadUrl.mockImplementation(defaultUpload);
    });

    it('stores the SBOM as its own object and creates the scan with it', async () => {
      const res = await post([
        field('type', 'sca'),
        field('branch', 'main'),
        sbom(),
        file(),
      ]);
      expect(res.statusCode).toBe(202);
      const { scanId } = res.json();
      const asked = fileClient.requestImportUploadUrl.mock.calls.map(
        ([req]) => req,
      );
      expect(asked).toEqual([
        {
          scanId,
          projectId: PROJECT,
          contentEncoding: 'identity',
          contentLength: SARIF.length,
        },
        {
          scanId,
          projectId: PROJECT,
          contentEncoding: 'identity',
          contentLength: SBOM.length,
          kind: 'sbom',
        },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        Buffer.from(fetchMock.mock.calls[1][1].body as Uint8Array).equals(SBOM),
      ).toBe(true);
      expect(scanClient.createScan.mock.calls[0][0]).toEqual(
        expect.objectContaining({ importType: 'sca', importSbom: true }),
      );
    });

    it('sends a gzip SBOM as gzip', async () => {
      const gz = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.alloc(8, 1)]);
      await post([
        field('type', 'sca'),
        field('branch', 'main'),
        file(),
        sbom(gz, 'bom.cdx.json.gz'),
      ]);
      expect(fileClient.requestImportUploadUrl.mock.calls[1][0]).toMatchObject({
        kind: 'sbom',
        contentEncoding: 'gzip',
        contentLength: 10,
      });
    });

    it('sends no importSbom and asks for no SBOM object without one', async () => {
      await post([field('type', 'sca'), field('branch', 'main'), file()]);
      expect(fileClient.requestImportUploadUrl).toHaveBeenCalledTimes(1);
      expect('importSbom' in scanClient.createScan.mock.calls[0][0]).toBe(
        false,
      );
    });

    it('answers 400 IMPORT_INVALID_REQUEST for an SBOM with another type, or two SBOMs', async () => {
      for (const parts of [
        [field('type', 'sast'), field('branch', 'main'), file(), sbom()],
        [
          field('type', 'container'),
          field('branch', 'main'),
          field('image', 'alpine:3.18'),
          file(),
          sbom(),
        ],
        [field('type', 'sca'), field('branch', 'main'), file(), sbom(), sbom()],
      ]) {
        const res = await post(parts);
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
      }
      nothingStored();
    });

    it('answers 400 IMPORT_INVALID_SBOM for an SBOM that is no JSON object, before any upload', async () => {
      for (const part of [
        sbom(Buffer.from('<bom/>'), 'bom.xml'),
        sbom(Buffer.from('[]')),
      ]) {
        const res = await post([
          field('type', 'sca'),
          field('branch', 'main'),
          file(),
          part,
        ]);
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('IMPORT_INVALID_SBOM');
      }
      nothingStored();
    });

    it('answers 413 IMPORT_UPLOAD_TOO_LARGE for an SBOM above 50 MiB', async () => {
      const big = Buffer.alloc(52_428_801, 0x20);
      big[0] = 0x7b;
      const res = await post([
        field('type', 'sca'),
        field('branch', 'main'),
        file(),
        sbom(big),
      ]);
      expect(res.statusCode).toBe(413);
      expect(res.json().code).toBe('IMPORT_UPLOAD_TOO_LARGE');
      nothingStored();
    });

    it('deletes the stored SARIF when the SBOM cannot be stored', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 500 }));
      const res = await post([
        field('type', 'sca'),
        field('branch', 'main'),
        file(),
        sbom(),
      ]);
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('IMPORT_STORAGE_UNAVAILABLE');
      expect(
        fileClient.deleteImportObject.mock.calls.map(([req]) => req),
      ).toEqual([
        { projectId: PROJECT, objectKey: `import/${PROJECT}/key.sarif` },
      ]);
      expect(scanClient.createScan).not.toHaveBeenCalled();
    });

    it('deletes both objects when CreateScan fails', async () => {
      scanClient.createScan.mockReturnValueOnce(
        grpcError(GrpcStatus.INVALID_ARGUMENT, 'IMPORT_FLAGS_CONFLICT'),
      );
      const res = await post([
        field('type', 'sca'),
        field('branch', 'main'),
        file(),
        sbom(),
      ]);
      expect(res.statusCode).toBe(400);
      expect(
        fileClient.deleteImportObject.mock.calls.map(([req]) => req),
      ).toEqual([
        { projectId: PROJECT, objectKey: `import/${PROJECT}/key.sarif` },
        { projectId: PROJECT, objectKey: `import/${PROJECT}/key.sbom` },
      ]);
      expect(scanClient.startScan).not.toHaveBeenCalled();
    });
  });

  it('never puts the upload URL in an error body or a log', async () => {
    const nestWarn = jest
      .spyOn(NestLogger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const nestError = jest
      .spyOn(NestLogger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      fetchMock
        .mockResolvedValueOnce(new Response(UPLOAD_URL, { status: 500 }))
        .mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${UPLOAD_URL}`));
      const parts = [field('type', 'sast'), field('branch', 'main'), file()];
      const bodies = [await post(parts), await post(parts)].map((r) => {
        expect(r.statusCode).toBe(503);
        return r.body;
      });
      for (const body of bodies) expect(body).not.toContain('minio');

      const logged = [
        ...Object.values(logger).flatMap((fn) => fn.mock.calls),
        ...nestWarn.mock.calls,
        ...nestError.mock.calls,
      ];
      expect(logged.length).toBeGreaterThan(0);
      for (const args of logged) {
        const text = args
          .map((a: unknown) =>
            a instanceof Error ? `${a.message} ${a.stack}` : String(a),
          )
          .join(' ');
        expect(text).not.toContain('minio');
        expect(text).not.toContain('X-Amz-Signature');
      }
    } finally {
      nestWarn.mockRestore();
      nestError.mockRestore();
    }
  });
});
