import 'reflect-metadata';
import { createHash } from 'node:crypto';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { Observable, of, throwError } from 'rxjs';

import { FILE_SERVICE_NAME } from '@grpc/file-management/file_management';
import { CLUSTER_SCAN_SERVICE_NAME } from '@grpc/security-scanning/security_scanning';
import { GlobalExceptionFilter } from 'src/core/exceptions';
import { registerMultipart } from 'src/core/http/register-multipart';
import {
  IMPORT_MAX_IN_FLIGHT_PER_POD,
  ScanImportService,
} from '../scan/import/scan-import.service';
import { ScanRunClient } from './scan-run.client';
import { ScanRunController } from './scan-run.controller';
import { ScanRunThrottleGuard } from './scan-run-throttle.guard';
import { ScanUploadTokenGuard } from './scan-upload-token.guard';

const SCAN = '1f0b7c1e-9c1a-6a40-8000-000000000001';
const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTAINER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY = `import/${PROJECT}/${SCAN}/${CONTAINER}.sarif`;
const TOKEN = `cdst_${'Q'.repeat(43)}`;
const HASH = createHash('sha256').update(TOKEN).digest('hex');
const URL_PATH = `/scan-runs/${SCAN}/results`;
const UPLOAD_URL = `http://storage:8333/bucket/${KEY}?X-Amz-Signature=deadbeefsecret`;
const SARIF = Buffer.from('{"version":"2.1.0","runs":[]}');

type Part =
  | { name: string; value: string }
  | { name: string; filename: string; content: Buffer };

/** A multipart/form-data body, parts in the order given. */
function multipart(parts: Part[]): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const boundary = '----cybedefendscanrunboundary7MA4YWxk';
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

type Req = Record<string, unknown>;
const rpc = (value: unknown) =>
  jest.fn((_req: Req, _metadata?: unknown): Observable<unknown> => of(value));
const grpcError = (code: number, details: string): Observable<unknown> =>
  throwError(() => ({ code, details }));

describe('POST /scan-runs/:scanId/results (ScanRunController)', () => {
  let app: NestFastifyApplication;
  let importService: ScanImportService;

  const clusterClient = {
    getScanCapabilities: rpc({ clusterScans: true }),
    authorizeScanUpload: rpc({
      projectId: PROJECT,
      organizationId: ORG,
      containerId: CONTAINER,
      category: 'sast',
    }),
    submitScanResults: rpc({ accepted: true }),
  };
  const fileClient = {
    requestImportUploadUrl: rpc({
      uploadUrl: UPLOAD_URL,
      objectKey: KEY,
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
  const throttle = { canActivate: jest.fn(async () => true) };
  let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;
  const realFetch = global.fetch;

  const post = (
    parts: Part[],
    headers: Record<string, string> = {
      authorization: `Bearer ${TOKEN}`,
      'x-cybedefend-scan-protocol': '1',
    },
  ) => {
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
      controllers: [ScanRunController],
      providers: [
        ScanRunClient,
        ScanImportService,
        ScanUploadTokenGuard,
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: (name: string) =>
              name === CLUSTER_SCAN_SERVICE_NAME ? clusterClient : undefined,
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
      // Its own spec covers it (scan-run-throttle.guard.spec.ts).
      .overrideGuard(ScanRunThrottleGuard)
      .useValue(throttle)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    await registerMultipart(app);
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    importService = moduleRef.get(ScanImportService);
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
  });

  const nothingStored = () => {
    expect(fileClient.requestImportUploadUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clusterClient.submitScanResults).not.toHaveBeenCalled();
  };

  it('stores under import/<p>/<s>/<c>.sarif and submits', async () => {
    const res = await post([file()]);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true });

    expect(throttle.canActivate).toHaveBeenCalledTimes(1);
    expect(fileClient.requestImportUploadUrl).toHaveBeenCalledTimes(1);
    expect(fileClient.requestImportUploadUrl.mock.calls[0][0]).toEqual({
      scanId: SCAN,
      projectId: PROJECT,
      containerId: CONTAINER,
      contentEncoding: 'identity',
      contentLength: SARIF.length,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(UPLOAD_URL);
    expect(clusterClient.submitScanResults).toHaveBeenCalledTimes(1);
    expect(clusterClient.submitScanResults.mock.calls[0][0]).toEqual({
      scanId: SCAN,
      tokenHash: HASH,
      objectKey: KEY,
    });
    expect(fileClient.deleteImportObject).not.toHaveBeenCalled();
  });

  it('stores a .sarif.gz as gzip', async () => {
    const gz = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00]);
    const res = await post([file(gz, 'results.sarif.gz')]);
    expect(res.statusCode).toBe(202);
    expect(fileClient.requestImportUploadUrl.mock.calls[0][0]).toMatchObject({
      contentEncoding: 'gzip',
    });
  });

  it('a bad token is refused before the body is read or anything is stored', async () => {
    const res = await post([file()], {
      authorization: 'Bearer not-a-token',
      'x-cybedefend-scan-protocol': '1',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('SCAN_TOKEN_INVALID');
    expect(clusterClient.authorizeScanUpload).not.toHaveBeenCalled();
    nothingStored();
  });

  it('a non-SARIF part ⇒ IMPORT_UNSUPPORTED_FILE', async () => {
    const res = await post([file(Buffer.from('%PDF-1.7'), 'results.pdf')]);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IMPORT_UNSUPPORTED_FILE');
    nothingStored();
  });

  it('a .sarif that is not JSON ⇒ IMPORT_INVALID_SARIF', async () => {
    const res = await post([file(Buffer.from('<xml/>'))]);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IMPORT_INVALID_SARIF');
    nothingStored();
  });

  it.each([
    ['no file part', [] as Part[]],
    ['a field part', [file(), { name: 'branch', value: 'main' }]],
    ['two file parts', [file(), file()]],
    [
      'a file part under another name',
      [{ ...file(), name: 'results' } as Part],
    ],
  ])('%s ⇒ IMPORT_INVALID_REQUEST', async (_name, parts) => {
    const res = await post(parts);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
    expect(clusterClient.submitScanResults).not.toHaveBeenCalled();
  });

  it('all slots taken ⇒ IMPORT_BUSY with Retry-After', async () => {
    let taken = 0;
    try {
      while (importService.tryAcquireSlot()) taken++;
      expect(taken).toBe(IMPORT_MAX_IN_FLIGHT_PER_POD);
      const res = await post([file()]);
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('IMPORT_BUSY');
      expect(res.headers['retry-after']).toBe('15');
      nothingStored();
    } finally {
      for (let i = 0; i < taken; i++) importService.releaseSlot();
    }
  });

  it('releases its slot after each upload, accepted or refused', async () => {
    for (let i = 0; i < IMPORT_MAX_IN_FLIGHT_PER_POD + 1; i++) {
      const res = await post([file(Buffer.from('nope'), 'x.txt')]);
      expect(res.statusCode).toBe(400);
    }
    const res = await post([file()]);
    expect(res.statusCode).toBe(202);
  });

  it('a storage failure ⇒ IMPORT_STORAGE_UNAVAILABLE and no submit', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const res = await post([file()]);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('IMPORT_STORAGE_UNAVAILABLE');
    expect(clusterClient.submitScanResults).not.toHaveBeenCalled();
  });

  it('a refused submit deletes the stored object', async () => {
    clusterClient.submitScanResults.mockReturnValueOnce(
      grpcError(GrpcStatus.UNAUTHENTICATED, 'SCAN_TOKEN_INVALID'),
    );
    const res = await post([file()]);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('SCAN_TOKEN_INVALID');
    expect(fileClient.deleteImportObject).toHaveBeenCalledTimes(1);
    expect(fileClient.deleteImportObject.mock.calls[0][0]).toEqual({
      projectId: PROJECT,
      objectKey: KEY,
    });
  });

  it('a submit refused for another key deletes the stored object', async () => {
    clusterClient.submitScanResults.mockReturnValueOnce(
      grpcError(GrpcStatus.INVALID_ARGUMENT, 'object key mismatch'),
    );
    const res = await post([file()]);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
    expect(fileClient.deleteImportObject).toHaveBeenCalledTimes(1);
  });

  it('a submit refused ALREADY_EXISTS keeps the stored object', async () => {
    clusterClient.submitScanResults.mockReturnValueOnce(
      grpcError(GrpcStatus.ALREADY_EXISTS, 'SCAN_RESULTS_ALREADY_SUBMITTED'),
    );
    const res = await post([file()]);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SCAN_RESULTS_ALREADY_SUBMITTED');
    expect(fileClient.deleteImportObject).not.toHaveBeenCalled();
  });

  it.each([
    ['UNAVAILABLE', GrpcStatus.UNAVAILABLE],
    ['DEADLINE_EXCEEDED', GrpcStatus.DEADLINE_EXCEEDED],
    ['INTERNAL', GrpcStatus.INTERNAL],
  ])(
    'a submit that fails %s keeps the object (the token may be spent) and answers 503',
    async (_name, code) => {
      clusterClient.submitScanResults.mockReturnValueOnce(
        grpcError(code, 'ImportResults failed'),
      );
      const res = await post([file()]);
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('IMPORT_UNAVAILABLE');
      expect(JSON.stringify(res.json())).not.toContain('ImportResults');
      expect(fileClient.deleteImportObject).not.toHaveBeenCalled();
    },
  );

  it('a submit answered accepted: false is 503 and keeps the object', async () => {
    clusterClient.submitScanResults.mockReturnValueOnce(
      of({ accepted: false }),
    );
    const res = await post([file()]);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('IMPORT_UNAVAILABLE');
    expect(fileClient.deleteImportObject).not.toHaveBeenCalled();
  });

  it('never logs the token, its hash or the signed URL', async () => {
    await post([file()]);
    clusterClient.submitScanResults.mockReturnValueOnce(
      grpcError(GrpcStatus.UNAUTHENTICATED, `bad token ${HASH}`),
    );
    await post([file()]);
    clusterClient.authorizeScanUpload.mockReturnValueOnce(
      grpcError(GrpcStatus.UNAVAILABLE, `down ${TOKEN}`),
    );
    await post([file()]);
    await post([file()], {
      authorization: `Bearer ${TOKEN}x`,
      'x-cybedefend-scan-protocol': '1',
    });

    const logged = [
      ...logger.log.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
      ...logger.debug.mock.calls,
      ...logger.verbose.mock.calls,
    ].map((args) => JSON.stringify(args));
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain('cdst_');
      expect(line).not.toContain(HASH);
      expect(line).not.toContain('X-Amz-Signature');
    }
  });

  describe('the SBOM of the sca container (protocol 2)', () => {
    const SBOM_KEY = `import/${PROJECT}/${SCAN}/${CONTAINER}.sbom`;
    const SBOM_URL = `http://storage:8333/bucket/${SBOM_KEY}?X-Amz-Signature=sbomsecret`;
    const SBOM = Buffer.from('{"bomFormat":"CycloneDX","specVersion":"1.6"}');
    const sbom = (
      content: Buffer = SBOM,
      filename = 'sbom.cdx.json',
    ): Part => ({
      name: 'sbom',
      filename,
      content,
    });
    const v2 = {
      authorization: `Bearer ${TOKEN}`,
      'x-cybedefend-scan-protocol': '2',
    };
    const asSca = () =>
      clusterClient.authorizeScanUpload.mockReturnValueOnce(
        of({
          projectId: PROJECT,
          organizationId: ORG,
          containerId: CONTAINER,
          category: 'sca',
        }),
      );
    /** The upload URL answers by kind: the SBOM gets its own key. */
    const keyedByKind = () =>
      fileClient.requestImportUploadUrl.mockImplementation((req: Req) =>
        of(
          req.kind === 'sbom'
            ? {
                uploadUrl: SBOM_URL,
                objectKey: SBOM_KEY,
                uploadExpiresAtMs: '1790000000000',
                uploadHeaders: {},
              }
            : {
                uploadUrl: UPLOAD_URL,
                objectKey: KEY,
                uploadExpiresAtMs: '1790000000000',
                uploadHeaders: {},
              },
        ),
      );
    const defaultUpload =
      fileClient.requestImportUploadUrl.getMockImplementation();
    afterEach(() => {
      fileClient.requestImportUploadUrl.mockImplementation(defaultUpload);
    });

    it('stores the SARIF and the SBOM under the container, then submits both keys in one call', async () => {
      asSca();
      keyedByKind();
      const res = await post([file(), sbom()], v2);
      expect(res.statusCode).toBe(202);
      expect(
        fileClient.requestImportUploadUrl.mock.calls.map(([r]) => r),
      ).toEqual([
        {
          scanId: SCAN,
          projectId: PROJECT,
          containerId: CONTAINER,
          contentEncoding: 'identity',
          contentLength: SARIF.length,
        },
        {
          scanId: SCAN,
          projectId: PROJECT,
          containerId: CONTAINER,
          contentEncoding: 'identity',
          contentLength: SBOM.length,
          kind: 'sbom',
        },
      ]);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        UPLOAD_URL,
        SBOM_URL,
      ]);
      expect(clusterClient.submitScanResults).toHaveBeenCalledTimes(1);
      expect(clusterClient.submitScanResults.mock.calls[0][0]).toEqual({
        scanId: SCAN,
        tokenHash: HASH,
        objectKey: KEY,
        sbomObjectKey: SBOM_KEY,
      });
    });

    it('takes the parts in any order, and a gzip SBOM', async () => {
      asSca();
      keyedByKind();
      const gz = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00]);
      const res = await post([sbom(gz, 'sbom.cdx.json.gz'), file()], v2);
      expect(res.statusCode).toBe(202);
      const sbomCall = fileClient.requestImportUploadUrl.mock.calls
        .map(([r]) => r)
        .find((r) => r.kind === 'sbom');
      expect(sbomCall).toMatchObject({ contentEncoding: 'gzip' });
    });

    it('protocol 2 without an SBOM is the SARIF alone', async () => {
      asSca();
      const res = await post([file()], v2);
      expect(res.statusCode).toBe(202);
      expect(fileClient.requestImportUploadUrl).toHaveBeenCalledTimes(1);
      expect(clusterClient.submitScanResults.mock.calls[0][0]).toEqual({
        scanId: SCAN,
        tokenHash: HASH,
        objectKey: KEY,
      });
    });

    it('an SBOM in protocol 1 ⇒ 400 IMPORT_INVALID_REQUEST, nothing stored', async () => {
      asSca();
      const res = await post([file(), sbom()]);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
      nothingStored();
    });

    it('an SBOM from any container but the sca one ⇒ 400 IMPORT_INVALID_REQUEST, nothing stored', async () => {
      const res = await post([file(), sbom()], v2);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
      nothingStored();
    });

    it.each([
      ['not a .json name', sbom(SBOM, 'sbom.xml')],
      ['not a JSON object', sbom(Buffer.from('<bom/>'))],
      ['a .json.gz that is not gzip', sbom(SBOM, 'sbom.json.gz')],
    ])(
      'an SBOM %s ⇒ 400 IMPORT_INVALID_SBOM, nothing stored',
      async (_n, part) => {
        asSca();
        const res = await post([file(), part], v2);
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('IMPORT_INVALID_SBOM');
        nothingStored();
      },
    );

    it('two SBOM parts ⇒ 400 IMPORT_INVALID_REQUEST', async () => {
      asSca();
      const res = await post([sbom(), sbom()], v2);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
      nothingStored();
    });

    it('an SBOM without a SARIF ⇒ 400 IMPORT_INVALID_REQUEST', async () => {
      asSca();
      const res = await post([sbom()], v2);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('IMPORT_INVALID_REQUEST');
      nothingStored();
    });

    it('an SBOM that cannot be stored deletes the SARIF and submits nothing', async () => {
      asSca();
      keyedByKind();
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 500 }));
      const res = await post([file(), sbom()], v2);
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('IMPORT_STORAGE_UNAVAILABLE');
      expect(clusterClient.submitScanResults).not.toHaveBeenCalled();
      expect(fileClient.deleteImportObject.mock.calls.map(([r]) => r)).toEqual([
        { projectId: PROJECT, objectKey: KEY },
      ]);
    });

    it('a submit refused before the claim deletes both objects', async () => {
      asSca();
      keyedByKind();
      clusterClient.submitScanResults.mockReturnValueOnce(
        grpcError(GrpcStatus.INVALID_ARGUMENT, 'IMPORT_OBJECT_KEY_INVALID'),
      );
      const res = await post([file(), sbom()], v2);
      expect(res.statusCode).toBe(400);
      expect(fileClient.deleteImportObject.mock.calls.map(([r]) => r)).toEqual([
        { projectId: PROJECT, objectKey: KEY },
        { projectId: PROJECT, objectKey: SBOM_KEY },
      ]);
    });

    it('a submit that may have spent the token keeps both objects', async () => {
      asSca();
      keyedByKind();
      clusterClient.submitScanResults.mockReturnValueOnce(
        grpcError(GrpcStatus.UNAVAILABLE, 'down'),
      );
      const res = await post([file(), sbom()], v2);
      expect(res.statusCode).toBe(503);
      expect(fileClient.deleteImportObject).not.toHaveBeenCalled();
    });
  });

  it('a call without a container keeps the import request unchanged (cloud import route)', async () => {
    await importService.storeImportFile(SCAN, PROJECT, SARIF, false);
    expect(fileClient.requestImportUploadUrl.mock.calls[0][0]).toEqual({
      scanId: SCAN,
      projectId: PROJECT,
      contentEncoding: 'identity',
      contentLength: SARIF.length,
    });
  });
});
