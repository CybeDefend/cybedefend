import 'reflect-metadata';
import { PassThrough } from 'node:stream';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { Observable, of } from 'rxjs';

import { FILE_SERVICE_NAME } from '@grpc/file-management/file_management';
import { CLUSTER_SCAN_SERVICE_NAME } from '@grpc/security-scanning/security_scanning';
import { GlobalExceptionFilter } from 'src/core/exceptions';
import { registerMultipart } from 'src/core/http/register-multipart';
import {
  IMPORT_MAX_IN_FLIGHT_PER_ORGANIZATION,
  IMPORT_MAX_READING_PER_POD,
  ScanImportService,
} from '../scan/import/scan-import.service';
import { ScanRunClient } from './scan-run.client';
import { ScanRunController } from './scan-run.controller';
import { ScanRunThrottleGuard } from './scan-run-throttle.guard';
import { ScanUploadTokenGuard } from './scan-upload-token.guard';

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTAINER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN = `cdst_${'Q'.repeat(43)}`;
const SARIF = Buffer.from('{"version":"2.1.0","runs":[]}');
const BOUNDARY = '----cybedefendscanrunslots';

/** A scan id per index; its organization is `org-<index % orgs>`. */
const scanId = (i: number) =>
  `1f0b7c1e-9c1a-6a40-8000-${String(i).padStart(12, '0')}`;
let orgOfScan: (scan: string) => string = () => 'org-0';

function body(): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="results.sarif"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    SARIF,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

type Req = Record<string, unknown>;

describe('POST /scan-runs/:scanId/results: slots and read places', () => {
  let app: NestFastifyApplication;
  const clusterClient = {
    getScanCapabilities: jest.fn(() => of({ clusterScans: true })),
    authorizeScanUpload: jest.fn(
      (req: Req): Observable<unknown> =>
        of({
          projectId: PROJECT,
          organizationId: orgOfScan(String(req.scanId)),
          containerId: CONTAINER,
          category: 'sast',
        }),
    ),
    submitScanResults: jest.fn(() => of({ accepted: true })),
  };
  const fileClient = {
    requestImportUploadUrl: jest.fn(() =>
      of({
        uploadUrl: 'http://storage:8333/bucket/k?X-Amz-Signature=x',
        objectKey: `import/${PROJECT}/k.sarif`,
        uploadExpiresAtMs: '1790000000000',
        uploadHeaders: {},
      }),
    ),
    deleteImportObject: jest.fn(() => of({ success: true })),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  const headers = {
    authorization: `Bearer ${TOKEN}`,
    'x-cybedefend-scan-protocol': '1',
    'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
  };

  const post = (i: number) =>
    app.inject({
      method: 'POST',
      url: `/scan-runs/${scanId(i)}/results`,
      payload: body(),
      headers,
    });

  /** An upload whose body stops before its end until `finish()`. */
  const slowPost = (i: number) => {
    const payload = body();
    const cut = payload.length - 16;
    const stream = new PassThrough();
    stream.write(payload.subarray(0, cut));
    const response = app.inject({
      method: 'POST',
      url: `/scan-runs/${scanId(i)}/results`,
      payload: stream,
      headers,
    });
    return { response, finish: () => stream.end(payload.subarray(cut)) };
  };

  const settle = async (authorized: number) => {
    for (
      let i = 0;
      i < 200 &&
      clusterClient.authorizeScanUpload.mock.calls.length < authorized;
      i++
    ) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 50));
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
      .overrideGuard(ScanRunThrottleGuard)
      .useValue({ canActivate: async () => true })
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
    fetchMock = jest.fn(async () => new Response(null, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    orgOfScan = (scan) => `org-${Number(scan.slice(-12))}`;
  });

  it('takes the pod slot only once the body is read: four slow uploads block nobody', async () => {
    const slow = [0, 1, 2, 3].map((i) => slowPost(i));
    await settle(4);
    // A fifth organization's upload is served while the four bodies trickle.
    expect((await post(4)).statusCode).toBe(202);
    slow.forEach((s) => s.finish());
    const done = await Promise.all(slow.map((s) => s.response));
    expect(done.map((r) => r.statusCode)).toEqual([202, 202, 202, 202]);
  });

  it('lets one organization hold at most two uploads at once, across its scans', async () => {
    expect(IMPORT_MAX_IN_FLIGHT_PER_ORGANIZATION).toBe(2);
    orgOfScan = (scan) => (Number(scan.slice(-12)) < 10 ? 'org-x' : 'org-y');
    const slow = [0, 1].map((i) => slowPost(i));
    await settle(2);
    const third = await post(2);
    expect(third.statusCode).toBe(503);
    expect(third.json().code).toBe('IMPORT_BUSY');
    expect(third.headers['retry-after']).toBe('15');
    // Another organization is not affected.
    expect((await post(10)).statusCode).toBe(202);
    slow.forEach((s) => s.finish());
    await Promise.all(slow.map((s) => s.response));
  });

  it('reads at most 8 bodies at once on a pod, whatever the number of organizations', async () => {
    expect(IMPORT_MAX_READING_PER_POD).toBe(8);
    const slow = Array.from({ length: 10 }, (_, i) => slowPost(i));
    const answered: number[] = [];
    slow.forEach((s) => s.response.then((r) => answered.push(r.statusCode)));
    await settle(10);
    expect(answered).toEqual([503, 503]);
    for (const s of slow) {
      s.finish();
      await s.response;
    }
  });

  describe('the time a body may take', () => {
    const saved = process.env.IMPORT_BODY_READ_TIMEOUT_MS;
    afterEach(() => {
      if (saved === undefined) delete process.env.IMPORT_BODY_READ_TIMEOUT_MS;
      else process.env.IMPORT_BODY_READ_TIMEOUT_MS = saved;
    });

    it('answers 408 IMPORT_UPLOAD_TIMEOUT to a body still arriving at the deadline, and stores nothing', async () => {
      process.env.IMPORT_BODY_READ_TIMEOUT_MS = '200';
      const res = await slowPost(0).response;
      expect(res.statusCode).toBe(408);
      expect(res.json().code).toBe('IMPORT_UPLOAD_TIMEOUT');
      expect(fileClient.requestImportUploadUrl).not.toHaveBeenCalled();
      expect(clusterClient.submitScanResults).not.toHaveBeenCalled();
    });
  });

  it('holds the read place until the answer: bodies being stored count against the pod bound', async () => {
    // Four uploads are being stored (their PUT hangs), four are still read.
    const pending: Array<(r: Response) => void> = [];
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => pending.push(resolve)),
    );
    const storing = [0, 1, 2, 3].map((i) => post(i));
    for (let i = 0; i < 200 && pending.length < 4; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(pending).toHaveLength(4);
    const slow = [4, 5, 6, 7].map((i) => slowPost(i));
    await settle(8);
    // The ninth body would be a ninth in memory: refused before it is read.
    const ninth = slowPost(8);
    const answer = await Promise.race([
      ninth.response,
      new Promise((r) => setTimeout(() => r('pending'), 300)),
    ]);
    expect(answer).not.toBe('pending');
    expect((answer as { statusCode: number }).statusCode).toBe(503);
    pending.forEach((resolve) => resolve(new Response(null, { status: 200 })));
    await Promise.all(storing);
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 200 }),
    );
    for (const s of slow) {
      s.finish();
      await s.response;
    }
    ninth.finish();
  });
});

describe('ScanImportService read places', () => {
  it('are one budget for the whole pod, shared by every instance (both upload routes)', () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    const a = new ScanImportService({} as never, logger);
    const b = new ScanImportService({} as never, logger);
    let taken = 0;
    while (a.tryAcquireReadPlace()) taken++;
    expect(taken).toBe(IMPORT_MAX_READING_PER_POD);
    expect(b.tryAcquireReadPlace()).toBe(false);
    a.releaseReadPlace();
    expect(b.tryAcquireReadPlace()).toBe(true);
    for (let i = 0; i < taken; i++) a.releaseReadPlace();
  });
});
