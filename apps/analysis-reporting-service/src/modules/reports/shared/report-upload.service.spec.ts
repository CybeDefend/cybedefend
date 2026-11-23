import { Test, TestingModule } from '@nestjs/testing';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { of, throwError } from 'rxjs';
import { Logger } from 'nestjs-pino';

import { ReportUploadService } from './report-upload.service';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';

// node-fetch is invoked via globalThis.fetch — patch it per-test.

describe('ReportUploadService', () => {
  const makeClient = (
    requestImpl: jest.Mock,
    finalizeImpl: jest.Mock,
  ): ClientGrpc =>
    ({
      getService: jest.fn().mockReturnValue({
        requestReportUploadUrl: requestImpl,
        finalizeReportUpload: finalizeImpl,
      }),
    }) as unknown as ClientGrpc;

  let originalFetch: typeof globalThis.fetch | undefined;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch as typeof globalThis.fetch;
  });

  const buildService = async (
    requestImpl: jest.Mock,
    finalizeImpl: jest.Mock,
  ): Promise<ReportUploadService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportUploadService,
        {
          provide: 'FILE_MANAGEMENT_SERVICE',
          useValue: makeClient(requestImpl, finalizeImpl),
        },
        { provide: Logger, useValue: createLoggerMock() },
      ],
    }).compile();
    const svc = module.get(ReportUploadService);
    // Service initialises its lazy gRPC client via onModuleInit.
    await svc.onModuleInit();
    return svc;
  };

  it('two-step happy path: PUT to signed URL, then finalize, then return download URL', async () => {
    const requestImpl = jest.fn().mockReturnValue(
      of({
        uploadUrl: 'https://signed-put/foo',
        objectPath: 'reports/p1/abc.pdf',
        uploadExpiresAtMs: Date.now() + 60_000,
      }),
    );
    const finalizeImpl = jest.fn().mockReturnValue(
      of({
        downloadUrl: 'https://signed-get/foo',
        expiresAtMs: Date.now() + 15 * 60 * 1000,
      }),
    );
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const svc = await buildService(requestImpl, finalizeImpl);
    const buffer = Buffer.from('%PDF-1.4 fake');

    const result = await svc.uploadReport({
      projectId: 'p1',
      filename: 'scanner-report.pdf',
      contentType: 'application/pdf',
      buffer,
    });

    expect(result.downloadUrl).toBe('https://signed-get/foo');
    expect(result.filename).toBe('scanner-report.pdf');
    expect(result.contentType).toBe('application/pdf');
    expect(Number(result.expiresAtMs)).toBeGreaterThan(Date.now());
    // The async pipeline persists objectPath so the URL can be re-minted later.
    expect(result.objectPath).toBe('reports/p1/abc.pdf');

    // step 1: request upload URL with the right params
    expect(requestImpl).toHaveBeenCalledWith({
      projectId: 'p1',
      filename: 'scanner-report.pdf',
      contentType: 'application/pdf',
    });

    // step 2: PUT to the signed URL with the buffer and content-type
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://signed-put/foo');
    expect((opts as any).method).toBe('PUT');
    expect((opts as any).body).toBe(buffer);
    expect((opts as any).headers['Content-Type']).toBe('application/pdf');

    // step 3: finalize with the object path, ttl, filename and projectId.
    // The filename is required so file-management can embed
    // Content-Disposition: attachment on the signed READ URL (otherwise the
    // browser opens the PDF inline). The projectId is required so
    // file-management can enforce that the objectPath belongs to the caller
    // tenant (see file.service.ts finalizeReportUpload guard).
    expect(finalizeImpl).toHaveBeenCalledWith({
      objectPath: 'reports/p1/abc.pdf',
      ttlSeconds: 900,
      filename: 'scanner-report.pdf',
      projectId: 'p1',
    });
  });

  // A Google Cloud Storage signed URL is minted with a signed
  // `x-goog-content-length-range` extension header (see file-management
  // requestReportUploadUrl). A signed header MUST be echoed on the PUT or the
  // storage rejects the request (HTTP 400). An S3 signed URL carries no such
  // header. Mirror the convention used by github/gitlab/dashboard: add the
  // header only for googleapis.com URLs.
  it('echoes x-goog-content-length-range on the PUT for a GCP signed URL', async () => {
    const requestImpl = jest.fn().mockReturnValue(
      of({
        uploadUrl:
          'https://storage.googleapis.com/bucket/reports/p1/abc.pdf?X-Goog-SignedHeaders=content-type%3Bhost%3Bx-goog-content-length-range',
        objectPath: 'reports/p1/abc.pdf',
        uploadExpiresAtMs: Date.now() + 60_000,
      }),
    );
    const finalizeImpl = jest.fn().mockReturnValue(
      of({
        downloadUrl: 'https://signed-get/foo',
        expiresAtMs: Date.now() + 15 * 60 * 1000,
      }),
    );
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const svc = await buildService(requestImpl, finalizeImpl);

    await svc.uploadReport({
      projectId: 'p1',
      filename: 'scanner-report.pdf',
      contentType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fake'),
    });

    const [, opts] = fetchMock.mock.calls[0];
    expect((opts as any).headers['Content-Type']).toBe('application/pdf');
    // Value MUST match exactly what file-management signs, or the signature
    // check fails (file.service.ts requestReportUploadUrl → 0,104857600).
    expect((opts as any).headers['x-goog-content-length-range']).toBe(
      '0,104857600',
    );
  });

  it('does NOT add the GCS-only header for an S3 signed URL', async () => {
    const requestImpl = jest.fn().mockReturnValue(
      of({
        uploadUrl: 'https://storage.example.test/bucket/reports/p1/abc.pdf?sig',
        objectPath: 'reports/p1/abc.pdf',
        uploadExpiresAtMs: Date.now() + 60_000,
      }),
    );
    const finalizeImpl = jest.fn().mockReturnValue(
      of({
        downloadUrl: 'https://signed-get/foo',
        expiresAtMs: Date.now() + 15 * 60 * 1000,
      }),
    );
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const svc = await buildService(requestImpl, finalizeImpl);

    await svc.uploadReport({
      projectId: 'p1',
      filename: 'scanner-report.pdf',
      contentType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fake'),
    });

    const [, opts] = fetchMock.mock.calls[0];
    expect((opts as any).headers['Content-Type']).toBe('application/pdf');
    expect(
      (opts as any).headers['x-goog-content-length-range'],
    ).toBeUndefined();
  });

  it('throws INTERNAL when the GCS PUT returns a non-2xx status (and does NOT finalize)', async () => {
    const requestImpl = jest.fn().mockReturnValue(
      of({
        uploadUrl: 'https://signed-put/foo',
        objectPath: 'reports/p1/abc.pdf',
        uploadExpiresAtMs: Date.now() + 60_000,
      }),
    );
    const finalizeImpl = jest.fn();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'AccessDenied',
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const svc = await buildService(requestImpl, finalizeImpl);

    await expect(
      svc.uploadReport({
        projectId: 'p1',
        filename: 'r.pdf',
        contentType: 'application/pdf',
        buffer: Buffer.from('x'),
      }),
    ).rejects.toBeInstanceOf(RpcException);

    expect(finalizeImpl).not.toHaveBeenCalled();
  });

  describe('signExisting', () => {
    it('re-signs a fresh download URL from an existing object path', async () => {
      const requestImpl = jest.fn();
      const finalizeImpl = jest.fn().mockReturnValue(
        of({
          downloadUrl: 'https://signed-get/refreshed',
          expiresAtMs: Date.now() + 15 * 60 * 1000,
        }),
      );
      globalThis.fetch = jest.fn() as unknown as typeof globalThis.fetch;

      const svc = await buildService(requestImpl, finalizeImpl);

      const result = await svc.signExisting({
        projectId: 'p1',
        objectPath: 'reports/p1/abc.pdf',
        filename: 'owasp-report.pdf',
      });

      expect(result.downloadUrl).toBe('https://signed-get/refreshed');
      expect(Number(result.expiresAtMs)).toBeGreaterThan(Date.now());
      // Re-signing never re-uploads: no PUT, no requestReportUploadUrl call.
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(requestImpl).not.toHaveBeenCalled();
      expect(finalizeImpl).toHaveBeenCalledWith({
        objectPath: 'reports/p1/abc.pdf',
        ttlSeconds: 900,
        filename: 'owasp-report.pdf',
        projectId: 'p1',
      });
    });

    it('propagates RpcException from finalize unchanged', async () => {
      const grpcErr = new RpcException({
        code: status.NOT_FOUND,
        message: 'object gone',
      });
      const finalizeImpl = jest.fn().mockReturnValue(throwError(() => grpcErr));
      const svc = await buildService(jest.fn(), finalizeImpl);

      await expect(
        svc.signExisting({
          projectId: 'p1',
          objectPath: 'reports/p1/missing.pdf',
          filename: 'r.pdf',
        }),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });

  it('propagates RpcException from RequestReportUploadUrl unchanged', async () => {
    const grpcErr = new RpcException({
      code: status.INTERNAL,
      message: 'GCS unavailable',
    });
    const requestImpl = jest.fn().mockReturnValue(throwError(() => grpcErr));
    const finalizeImpl = jest.fn();
    globalThis.fetch = jest.fn() as unknown as typeof globalThis.fetch;

    const svc = await buildService(requestImpl, finalizeImpl);

    await expect(
      svc.uploadReport({
        projectId: 'p1',
        filename: 'r.pdf',
        contentType: 'application/pdf',
        buffer: Buffer.from('x'),
      }),
    ).rejects.toBeInstanceOf(RpcException);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(finalizeImpl).not.toHaveBeenCalled();
  });

  // Hard-delete a stored report object (retention purge + delete).
  describe('deleteReport', () => {
    const buildWithDelete = async (
      deleteImpl: jest.Mock,
    ): Promise<ReportUploadService> => {
      const client = {
        getService: jest
          .fn()
          .mockReturnValue({ deleteReportObject: deleteImpl }),
      } as unknown as ClientGrpc;
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReportUploadService,
          { provide: 'FILE_MANAGEMENT_SERVICE', useValue: client },
          { provide: Logger, useValue: createLoggerMock() },
        ],
      }).compile();
      const svc = module.get(ReportUploadService);
      await svc.onModuleInit();
      return svc;
    };

    it('calls file-management deleteReportObject with objectPath + projectId', async () => {
      const deleteImpl = jest
        .fn()
        .mockReturnValue(of({ success: true, message: 'ok' }));
      const svc = await buildWithDelete(deleteImpl);

      await svc.deleteReport('reports/p1/r.pdf', 'p1');

      expect(deleteImpl).toHaveBeenCalledWith({
        objectPath: 'reports/p1/r.pdf',
        projectId: 'p1',
      });
    });

    it('surfaces a cross-tenant rejection from file-management as INTERNAL (never swallowed)', async () => {
      const deleteImpl = jest.fn().mockReturnValue(
        throwError(
          () =>
            new RpcException({
              code: status.INVALID_ARGUMENT,
              message: 'objectPath does not belong to projectId',
            }),
        ),
      );
      const svc = await buildWithDelete(deleteImpl);

      // Assert the precise surfaced code: `safeGrpcCall` normalises a downstream
      // gRPC error into INTERNAL for the caller (a cross-tenant path is an AR
      // invariant violation, so 5xx is correct). A bare toBeDefined() would pass
      // even if the error were swallowed or mutated into a success — this locks
      // in that it propagates as a real INTERNAL rejection.
      await expect(
        svc.deleteReport('reports/p2/r.pdf', 'p1'),
      ).rejects.toMatchObject({ error: { code: status.INTERNAL } });
    });
  });
});
