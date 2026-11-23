import { Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { ModuleRef } from '@nestjs/core';
import type { ClientGrpc } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { NEVER, Observable, of, throwError } from 'rxjs';
import type { ImportResultsRequest } from '@grpc/analysis-reporting/result';
import type { Repository } from 'typeorm';
import type { Container } from 'src/entities/container.entity';
import type { Scan } from 'src/entities/scan.entity';
import type { ScanUploadToken } from 'src/entities/scan-upload-token.entity';
import type { FileManagementService } from '../../file/file-management.service';
import { ScanService } from '../scan.service';
import type { ScanUploadTokens } from './scan-upload-tokens';
import {
  clusterFailureMessage,
  clusterFailureName,
  containerFailureCode,
  SCAN_RESULTS_IMPORT_TIMEOUT_MS,
  ScanResultsService,
} from './scan-results.service';

/**
 * Community scans on a connected Kubernetes cluster: a scanner pod's results reach the import pipeline through its own
 * container, and analysis-reporting's end of import closes that container.
 *
 * - Refusal order of authorize: protocol, then the token, then
 *   a spent token (ALREADY_EXISTS, so a retry after a lost answer stops),
 *   then the container's state.
 * - Once the token is claimed, a submit never answers INVALID_ARGUMENT nor
 *   FAILED_PRECONDITION: the gateway would delete an object being imported.
 */

const SCAN = '11111111-1111-4111-8111-111111111111';
const CONTAINER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const HASH = 'a'.repeat(64);
const KEY = `import/p1/${SCAN}/${CONTAINER}.sarif`;
const SBOM_KEY = `import/p1/${SCAN}/${CONTAINER}.sbom`;
/** The sca container of a cluster scan (trivy fs): the one that may send an SBOM. */
const SCA = {
  container: {
    podName: `cd-scan-trivy-fs-${CONTAINER}`,
    image: 'cybedefend-scanners/trivy-fs:1.0.0',
  },
  token: { category: 'sca' },
};

const rpc = (e: unknown): { code: number; message: string } =>
  (e as RpcException).getError() as { code: number; message: string };

function harness(
  opts: {
    scan?: Partial<Scan>;
    container?: Partial<Container> | null;
    token?: Partial<ScanUploadToken>;
  } = {},
) {
  const scan = {
    id: SCAN,
    projectId: 'p1',
    organizationId: 'o1',
    state: 'running',
    branch: 'main',
    ...opts.scan,
  } as Scan;
  const container =
    opts.container === null
      ? null
      : ({
          id: CONTAINER,
          scanId: SCAN,
          podName: `cd-scan-zizmor-${CONTAINER}`,
          image: 'cybedefend-scanners/zizmor:1.0.0',
          status: 'starting',
          ...opts.container,
        } as Container);
  const tokenRow = {
    scanId: SCAN,
    containerId: CONTAINER,
    tokenHash: HASH,
    category: 'cicd',
    severities: 'high,low',
    ...opts.token,
  } as ScanUploadToken;

  const tokens = {
    authorize: jest.fn(async () => ({ row: tokenRow })),
    claim: jest.fn(async () => 'claimed' as const),
    release: jest.fn(async () => true),
  };
  const scanState = { current: scan };
  const scans = {
    findOne: jest.fn(async () => ({ ...scanState.current })),
    update: jest.fn<
      Promise<{ affected: number }>,
      [unknown, Record<string, unknown>]
    >(async () => ({ affected: 1 })),
  };
  const firstFailed = { current: null as Partial<Container> | null };
  const containers = {
    findOne: jest.fn(async (q: { where: Record<string, unknown> }) => {
      if (q.where.status === 'failed') return firstFailed.current;
      return container && q.where.id === container.id ? { ...container } : null;
    }),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const files = { deleteImportObject: jest.fn(async () => undefined) };
  const importResults = jest.fn<
    Observable<{ accepted: boolean }>,
    [ImportResultsRequest]
  >(() => of({ accepted: true }));
  const ar = {
    getService: () => ({ importResults }),
  } as unknown as ClientGrpc;
  const updateScan = jest.fn(async () => ({ success: true, message: 'ok' }));
  const moduleRef = {
    get: jest.fn((token: unknown) => {
      if (token === ScanService) return { updateScan };
      throw new Error('unexpected');
    }),
  } as unknown as ModuleRef;

  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  const service = new ScanResultsService(
    tokens as unknown as ScanUploadTokens,
    scans as unknown as Repository<Scan>,
    containers as unknown as Repository<Container>,
    files as unknown as FileManagementService,
    ar,
    moduleRef,
  );
  service.onModuleInit();
  return {
    service,
    tokens,
    scans,
    scanState,
    containers,
    firstFailed,
    files,
    importResults,
    updateScan,
    warn,
  };
}

describe('ScanResultsService', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('authorize', () => {
    const request = (over: Record<string, unknown> = {}) => ({
      scanId: SCAN,
      tokenHash: HASH,
      protocolVersion: 1,
      ...over,
    });

    it('answers the container, its category, the project and the organisation', async () => {
      const h = harness();
      await expect(h.service.authorize(request())).resolves.toEqual({
        projectId: 'p1',
        organizationId: 'o1',
        containerId: CONTAINER,
        category: 'cicd',
      });
    });

    it('accepts protocol 2, in which the sca container may send its SBOM', async () => {
      const h = harness();
      await expect(
        h.service.authorize(request({ protocolVersion: 2 })),
      ).resolves.toMatchObject({ containerId: CONTAINER, category: 'cicd' });
    });

    it.each([0, 3, 99])(
      'authorize refuses protocol %s with SCAN_PROTOCOL_UNSUPPORTED, before reading the token',
      async (protocolVersion) => {
        const h = harness();
        const e = await h.service
          .authorize(request({ protocolVersion }))
          .catch((x: unknown) => x);
        expect(rpc(e)).toEqual({
          code: status.FAILED_PRECONDITION,
          message: 'SCAN_PROTOCOL_UNSUPPORTED',
        });
        expect(h.tokens.authorize).not.toHaveBeenCalled();
      },
    );

    it('an unknown, foreign or expired token is UNAUTHENTICATED SCAN_TOKEN_INVALID', async () => {
      const h = harness();
      h.tokens.authorize.mockResolvedValueOnce({ refused: 'invalid' } as never);
      const e = await h.service.authorize(request()).catch((x: unknown) => x);
      expect(rpc(e)).toEqual({
        code: status.UNAUTHENTICATED,
        message: 'SCAN_TOKEN_INVALID',
      });
    });

    it('a spent token answers ALREADY_EXISTS, so a retry stops', async () => {
      const h = harness();
      h.tokens.authorize.mockResolvedValueOnce({ refused: 'used' } as never);
      const e = await h.service.authorize(request()).catch((x: unknown) => x);
      expect(rpc(e)).toEqual({
        code: status.ALREADY_EXISTS,
        message: 'SCAN_RESULTS_ALREADY_SUBMITTED',
      });
    });

    it('a spent token whose container is already closed answers ALREADY_EXISTS', async () => {
      const h = harness({ container: { status: 'completed' } });
      h.tokens.authorize.mockResolvedValueOnce({ refused: 'used' } as never);
      const e = await h.service.authorize(request()).catch((x: unknown) => x);
      expect(rpc(e).code).toBe(status.ALREADY_EXISTS);
    });

    it.each(['completed', 'failed', 'cancelled'])(
      "a closed container's token is invalid (%s)",
      async (s) => {
        const h = harness({ container: { status: s } });
        const e = await h.service.authorize(request()).catch((x: unknown) => x);
        expect(rpc(e)).toEqual({
          code: status.UNAUTHENTICATED,
          message: 'SCAN_TOKEN_INVALID',
        });
      },
    );

    it('a missing container is invalid', async () => {
      const h = harness({ container: null });
      const e = await h.service.authorize(request()).catch((x: unknown) => x);
      expect(rpc(e).code).toBe(status.UNAUTHENTICATED);
    });

    it('accepts a running container', async () => {
      const h = harness({ container: { status: 'running' } });
      await expect(h.service.authorize(request())).resolves.toMatchObject({
        containerId: CONTAINER,
      });
    });
  });

  describe('submit', () => {
    const request = (over: Record<string, unknown> = {}) => ({
      scanId: SCAN,
      tokenHash: HASH,
      objectKey: KEY,
      ...over,
    });

    it('submit sends ImportResults with containerId, category cicd for zizmor, severities high,low', async () => {
      const h = harness();
      await expect(h.service.submit(request())).resolves.toEqual({
        accepted: true,
      });
      expect(h.tokens.claim).toHaveBeenCalledWith(SCAN, HASH, expect.any(Date));
      expect(h.importResults).toHaveBeenCalledTimes(1);
      expect(h.importResults).toHaveBeenCalledWith({
        scanId: SCAN,
        projectId: 'p1',
        organizationId: 'o1',
        branch: 'main',
        vulnerabilityType: 'cicd',
        format: 'sarif',
        fileKey: KEY,
        containerId: CONTAINER,
        severities: 'high,low',
      });
      expect(h.files.deleteImportObject).not.toHaveBeenCalled();
    });

    it('a scan without a branch imports on main', async () => {
      const h = harness({ scan: { branch: null } });
      await h.service.submit(request());
      expect(h.importResults.mock.calls[0][0].branch).toBe('main');
    });

    it('never sends empty severities: an empty list means every severity', async () => {
      const h = harness({ token: { severities: '' } });
      await h.service.submit(request());
      expect(h.importResults.mock.calls[0][0].severities).toBe(
        'critical,high,medium,low',
      );
    });

    it("submit refuses another container's key, before the claim", async () => {
      const h = harness();
      for (const objectKey of [
        `import/p1/${SCAN}/${OTHER}.sarif`,
        `import/p1/${SCAN}.sarif`,
        `import/p2/${SCAN}/${CONTAINER}.sarif`,
      ]) {
        const e = await h.service
          .submit(request({ objectKey }))
          .catch((x: unknown) => x);
        expect(rpc(e).code).toBe(status.INVALID_ARGUMENT);
      }
      expect(h.tokens.claim).not.toHaveBeenCalled();
      expect(h.importResults).not.toHaveBeenCalled();
    });

    it('the sca container hands its SBOM to ImportResults as sbomFileKey', async () => {
      const h = harness(SCA);
      await expect(
        h.service.submit(request({ sbomObjectKey: SBOM_KEY })),
      ).resolves.toEqual({ accepted: true });
      expect(h.importResults).toHaveBeenCalledWith(
        expect.objectContaining({
          vulnerabilityType: 'sca',
          fileKey: KEY,
          containerId: CONTAINER,
          sbomFileKey: SBOM_KEY,
        }),
      );
      expect(h.files.deleteImportObject).not.toHaveBeenCalled();
    });

    it('without an SBOM, the sca container sends no sbomFileKey (protocol 1, an older scanner)', async () => {
      const h = harness(SCA);
      await h.service.submit(request());
      expect(h.importResults.mock.calls[0][0]).not.toHaveProperty(
        'sbomFileKey',
      );
    });

    it('refuses an SBOM from any container but the sca one, before the claim', async () => {
      const h = harness();
      const e = await h.service
        .submit(request({ sbomObjectKey: SBOM_KEY }))
        .catch((x: unknown) => x);
      expect(rpc(e)).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'IMPORT_OBJECT_KEY_INVALID',
      });
      expect(h.tokens.claim).not.toHaveBeenCalled();
      expect(h.importResults).not.toHaveBeenCalled();
    });

    it('refuses an SBOM key of another container or scan, or a SARIF key, before the claim', async () => {
      const h = harness(SCA);
      for (const sbomObjectKey of [
        `import/p1/${SCAN}/${OTHER}.sbom`,
        `import/p1/${SCAN}.sbom`,
        `import/p2/${SCAN}/${CONTAINER}.sbom`,
        KEY,
      ]) {
        const e = await h.service
          .submit(request({ sbomObjectKey }))
          .catch((x: unknown) => x);
        expect(rpc(e)).toEqual({
          code: status.INVALID_ARGUMENT,
          message: 'IMPORT_OBJECT_KEY_INVALID',
        });
      }
      expect(h.tokens.claim).not.toHaveBeenCalled();
      expect(h.importResults).not.toHaveBeenCalled();
    });

    it('a deterministic refusal of the sca container deletes its SBOM with its SARIF', async () => {
      const h = harness(SCA);
      h.importResults.mockReturnValueOnce(of({ accepted: false }) as never);
      await h.service
        .submit(request({ sbomObjectKey: SBOM_KEY }))
        .catch((x: unknown) => x);
      expect(h.files.deleteImportObject).toHaveBeenCalledWith('p1', KEY);
      expect(h.files.deleteImportObject).toHaveBeenCalledWith('p1', SBOM_KEY);
    });

    it('a close that fails after a refusal still deletes the SBOM with the SARIF', async () => {
      const h = harness(SCA);
      h.importResults.mockReturnValueOnce(of({ accepted: false }) as never);
      h.updateScan.mockRejectedValueOnce(new Error('db down'));
      await h.service
        .submit(request({ sbomObjectKey: SBOM_KEY }))
        .catch((x: unknown) => x);
      expect(h.files.deleteImportObject).toHaveBeenCalledWith('p1', KEY);
      expect(h.files.deleteImportObject).toHaveBeenCalledWith('p1', SBOM_KEY);
    });

    it('an unavailable import keeps the SBOM with the SARIF for the retry', async () => {
      const h = harness(SCA);
      h.importResults.mockReturnValueOnce(
        throwError(() => ({ code: status.UNAVAILABLE })) as never,
      );
      await h.service
        .submit(request({ sbomObjectKey: SBOM_KEY }))
        .catch((x: unknown) => x);
      expect(h.tokens.release).toHaveBeenCalledTimes(1);
      expect(h.files.deleteImportObject).not.toHaveBeenCalled();
    });

    it('a spent token answers ALREADY_EXISTS and imports nothing', async () => {
      const h = harness();
      h.tokens.authorize.mockResolvedValueOnce({ refused: 'used' } as never);
      const e = await h.service.submit(request()).catch((x: unknown) => x);
      expect(rpc(e).code).toBe(status.ALREADY_EXISTS);
      expect(h.importResults).not.toHaveBeenCalled();
    });

    it('a claim lost to a concurrent submit answers ALREADY_EXISTS', async () => {
      const h = harness();
      h.tokens.claim.mockResolvedValueOnce('used' as never);
      const e = await h.service.submit(request()).catch((x: unknown) => x);
      expect(rpc(e)).toEqual({
        code: status.ALREADY_EXISTS,
        message: 'SCAN_RESULTS_ALREADY_SUBMITTED',
      });
      expect(h.importResults).not.toHaveBeenCalled();
    });

    it("a closed container's token is invalid at submit too", async () => {
      const h = harness({ container: { status: 'failed' } });
      const e = await h.service.submit(request()).catch((x: unknown) => x);
      expect(rpc(e).code).toBe(status.UNAUTHENTICATED);
      expect(h.tokens.claim).not.toHaveBeenCalled();
    });

    it('an ImportResults failure gives the token back: the container stays open, the object is kept, UNAVAILABLE', async () => {
      const h = harness();
      h.importResults.mockReturnValueOnce(
        throwError(() => ({ code: status.UNAVAILABLE })) as never,
      );
      const e = await h.service.submit(request()).catch((x: unknown) => x);
      expect(rpc(e)).toEqual({
        code: status.UNAVAILABLE,
        message: 'IMPORT_UNAVAILABLE',
      });
      // the claim's own time is given back (one conditional UPDATE)
      const claimedAt = (h.tokens.claim.mock.calls[0] as unknown[])[2];
      expect(h.tokens.release).toHaveBeenCalledWith(HASH, claimedAt);
      expect(h.containers.update).not.toHaveBeenCalled();
      expect(h.updateScan).not.toHaveBeenCalled();
      // the retry overwrites the same key with the same SARIF
      expect(h.files.deleteImportObject).not.toHaveBeenCalled();
    });

    it('seam: the first ImportResults answers UNAVAILABLE, the retry claims again and is accepted, the container never fails', async () => {
      const h = harness();
      h.importResults
        .mockReturnValueOnce(
          throwError(() => ({ code: status.UNAVAILABLE })) as never,
        )
        .mockReturnValueOnce(of({ accepted: true }));
      const first = await h.service.submit(request()).catch((x: unknown) => x);
      expect(rpc(first).code).toBe(status.UNAVAILABLE);
      await expect(h.service.submit(request())).resolves.toEqual({
        accepted: true,
      });
      expect(h.tokens.claim).toHaveBeenCalledTimes(2);
      expect(h.importResults).toHaveBeenCalledTimes(2);
      expect(h.importResults.mock.calls[1][0].fileKey).toBe(KEY);
      expect(h.updateScan).not.toHaveBeenCalled();
      expect(h.containers.update).not.toHaveBeenCalled();
      expect(h.files.deleteImportObject).not.toHaveBeenCalled();
    });

    it('a deadline gives the token back too', async () => {
      jest.useFakeTimers();
      try {
        const h = harness();
        h.importResults.mockReturnValueOnce(NEVER as never);
        const pending = h.service.submit(request()).catch((x: unknown) => x);
        await jest.advanceTimersByTimeAsync(SCAN_RESULTS_IMPORT_TIMEOUT_MS);
        expect(rpc(await pending).code).toBe(status.UNAVAILABLE);
        expect(SCAN_RESULTS_IMPORT_TIMEOUT_MS).toBe(15_000);
        expect(h.tokens.release).toHaveBeenCalledTimes(1);
        expect(h.updateScan).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it.each([
      ['RESOURCE_EXHAUSTED', { code: status.RESOURCE_EXHAUSTED }],
      ['DEADLINE_EXCEEDED', { code: status.DEADLINE_EXCEEDED }],
      ['a transport error with no gRPC code', new Error('socket hang up')],
    ])('an unavailability (%s) gives the token back', async (_label, error) => {
      const h = harness();
      h.importResults.mockReturnValueOnce(throwError(() => error) as never);
      const e = await h.service.submit(request()).catch((x: unknown) => x);
      expect(rpc(e).code).toBe(status.UNAVAILABLE);
      expect(h.tokens.release).toHaveBeenCalledTimes(1);
      expect(h.updateScan).not.toHaveBeenCalled();
      expect(h.files.deleteImportObject).not.toHaveBeenCalled();
    });

    it.each([
      ['accepted: false', () => of({ accepted: false })],
      [
        'INVALID_ARGUMENT',
        () => throwError(() => ({ code: status.INVALID_ARGUMENT })),
      ],
      [
        'FAILED_PRECONDITION',
        () => throwError(() => ({ code: status.FAILED_PRECONDITION })),
      ],
    ])(
      'a deterministic refusal (%s) keeps the token spent: the container fails at once and the object is deleted',
      async (_label, answer) => {
        const h = harness();
        h.importResults.mockReturnValueOnce(answer() as never);
        const e = await h.service.submit(request()).catch((x: unknown) => x);
        expect(rpc(e)).toEqual({
          code: status.UNAVAILABLE,
          message: 'IMPORT_UNAVAILABLE',
        });
        expect(h.tokens.release).not.toHaveBeenCalled();
        expect(h.containers.update).toHaveBeenCalledWith(
          expect.objectContaining({ id: CONTAINER }),
          { outcomeReason: 'IMPORT_UNAVAILABLE' },
        );
        expect(h.updateScan).toHaveBeenCalledWith(
          expect.objectContaining({ scanId: SCAN, state: 'failed' }),
        );
        expect(h.files.deleteImportObject).toHaveBeenCalledWith('p1', KEY);
      },
    );

    it.each([
      ['gives nothing back', async () => false],
      [
        'throws',
        async () => {
          throw new Error('db down');
        },
      ],
    ])(
      'a give-back that %s: the container fails IMPORT_UNAVAILABLE and the object is deleted, as before',
      async (_label, release) => {
        const h = harness();
        h.tokens.release.mockImplementationOnce(release);
        h.importResults.mockReturnValueOnce(
          throwError(() => ({ code: status.UNAVAILABLE })) as never,
        );
        const e = await h.service.submit(request()).catch((x: unknown) => x);
        expect(rpc(e)).toEqual({
          code: status.UNAVAILABLE,
          message: 'IMPORT_UNAVAILABLE',
        });
        expect(h.containers.update).toHaveBeenCalledWith(
          expect.objectContaining({ id: CONTAINER }),
          { outcomeReason: 'IMPORT_UNAVAILABLE' },
        );
        expect(h.updateScan).toHaveBeenCalledWith({
          scanId: SCAN,
          podName: `cd-scan-zizmor-${CONTAINER}`,
          state: 'failed',
          totalVulnerabilities: 0,
        });
        expect(h.files.deleteImportObject).toHaveBeenCalledWith('p1', KEY);
      },
    );

    it('after the claim, never INVALID_ARGUMENT nor FAILED_PRECONDITION', async () => {
      const h = harness();
      h.importResults.mockReturnValueOnce(
        throwError(() => ({
          code: status.INVALID_ARGUMENT,
          details: 'x',
        })) as never,
      );
      h.updateScan.mockRejectedValueOnce(
        new RpcException({ code: status.FAILED_PRECONDITION, message: 'x' }),
      );
      const e = await h.service.submit(request()).catch((x: unknown) => x);
      expect([status.UNAVAILABLE, status.INTERNAL]).toContain(rpc(e).code);
      expect(h.files.deleteImportObject).toHaveBeenCalledWith('p1', KEY);
    });
  });

  describe('closeContainer', () => {
    const request = (over: Record<string, unknown> = {}) => ({
      scanId: SCAN,
      containerId: CONTAINER,
      status: 'completed',
      errorCode: '',
      findingsCount: 7,
      toolName: 'zizmor',
      ...over,
    });

    it('closeContainer completes the container; the scan completes when it was the last', async () => {
      const h = harness();
      h.updateScan.mockImplementationOnce(async () => {
        h.scanState.current = { ...h.scanState.current, state: 'completed' };
        return { success: true, message: 'ok' };
      });
      await expect(h.service.closeContainer(request())).resolves.toEqual({
        success: true,
        message: 'Container completed',
      });
      expect(h.updateScan).toHaveBeenCalledWith({
        scanId: SCAN,
        podName: `cd-scan-zizmor-${CONTAINER}`,
        state: 'completed',
        totalVulnerabilities: 7,
      });
      expect(h.files.deleteImportObject).toHaveBeenCalledWith('p1', KEY);
      // no outcome, no scan error on a completion
      expect(h.containers.update).not.toHaveBeenCalled();
      expect(h.scans.update).not.toHaveBeenCalled();
    });

    it.each([
      ['IMPORT_INVALID_SARIF', 70, 'import'],
      ['CLUSTER_NO_RESULTS', 80, 'cluster'],
      ['CLUSTER_ARCHIVE_FETCH_FAILED', 88, 'cluster'],
    ])(
      "closeContainer of a failed container sets the scan's error from its code when the scan fails (%s)",
      async (code, errorCode, errorCategory) => {
        const h = harness();
        h.updateScan.mockImplementationOnce(async () => {
          h.scanState.current = { ...h.scanState.current, state: 'failed' };
          h.firstFailed.current = { id: CONTAINER, outcomeReason: code };
          return { success: true, message: 'ok' };
        });
        await h.service.closeContainer(
          request({ status: 'failed', errorCode: code, findingsCount: 0 }),
        );
        // the code is the container's outcome, written before the close
        expect(h.containers.update).toHaveBeenCalledWith(
          expect.objectContaining({ id: CONTAINER }),
          { outcomeReason: code },
        );
        expect(h.containers.update.mock.invocationCallOrder[0]).toBeLessThan(
          h.updateScan.mock.invocationCallOrder[0],
        );
        expect(h.scans.update).toHaveBeenCalledWith(
          { id: SCAN, state: 'failed' },
          {
            errorCode,
            errorCategory,
            errorMessage: expect.any(String),
          },
        );
        const message = (h.scans.update.mock.calls[0] as unknown[])[1] as {
          errorMessage: string;
        };
        expect(message.errorMessage).not.toMatch(/Unknown error/);
      },
    );

    // The operator's first check is the address the pods were given: the
    // message names it (its origin only, never a path or credentials).
    it('names the storage address the pods fetch the archive from when a pod could not download it (88)', async () => {
      const saved = process.env.S3_PUBLIC_ENDPOINT;
      const savedEdition = process.env.CYBEDEFEND_EDITION;
      process.env.S3_PUBLIC_ENDPOINT =
        'http://user:pw@host.docker.internal:9000/some/path';
      process.env.CYBEDEFEND_EDITION = 'community';
      try {
        const h = harness();
        h.updateScan.mockImplementationOnce(async () => {
          h.scanState.current = { ...h.scanState.current, state: 'failed' };
          h.firstFailed.current = {
            id: CONTAINER,
            outcomeReason: 'CLUSTER_ARCHIVE_FETCH_FAILED',
          };
          return { success: true, message: 'ok' };
        });
        await h.service.closeContainer(
          request({
            status: 'failed',
            errorCode: 'CLUSTER_ARCHIVE_FETCH_FAILED',
            findingsCount: 0,
          }),
        );
        const columns = (h.scans.update.mock.calls[0] as unknown[])[1] as {
          errorCode: number;
          errorMessage: string;
        };
        expect(columns.errorCode).toBe(88);
        expect(columns.errorMessage).toMatch(
          /CYBEDEFEND_STORAGE_PUBLIC_URL.*http:\/\/host\.docker\.internal:9000/,
        );
        expect(columns.errorMessage).not.toMatch(/pw|some\/path|Git provider/);
      } finally {
        if (saved === undefined) delete process.env.S3_PUBLIC_ENDPOINT;
        else process.env.S3_PUBLIC_ENDPOINT = saved;
        if (savedEdition === undefined) delete process.env.CYBEDEFEND_EDITION;
        else process.env.CYBEDEFEND_EDITION = savedEdition;
      }
    });

    it('the scan carries its error (84) at the moment updateScan flips it: one conditional UPDATE, before the close', async () => {
      const h = harness();
      h.scans.update.mockImplementation(
        async (_where: unknown, columns: Record<string, unknown>) => {
          h.scanState.current = { ...h.scanState.current, ...columns };
          return { affected: 1 };
        },
      );
      let errorAtFlip: unknown = 'not called';
      h.updateScan.mockImplementationOnce(async () => {
        errorAtFlip = h.scanState.current.errorCode;
        h.scanState.current = { ...h.scanState.current, state: 'failed' };
        return { success: true, message: 'ok' };
      });
      await h.service.closeContainer(
        request({
          status: 'failed',
          errorCode: 'CLUSTER_IMAGE_INCOMPATIBLE',
          findingsCount: 0,
        }),
      );
      expect(errorAtFlip).toBe(84);
      const [where, columns] = h.scans.update.mock.calls[0] as unknown as [
        { id: string; state: { _type: string; _value: { _value: string[] } } },
        Record<string, unknown>,
      ];
      expect(where.id).toBe(SCAN);
      // never on a terminal scan
      expect(where.state._type).toBe('not');
      expect(where.state._value._value.sort()).toEqual(
        ['cancelled', 'completed', 'completed_degraded', 'failed'].sort(),
      );
      expect(columns).toMatchObject({
        errorCode: 84,
        errorCategory: 'cluster',
      });
      // after the container's outcome, before the close
      expect(h.containers.update.mock.invocationCallOrder[0]).toBeLessThan(
        h.scans.update.mock.invocationCallOrder[0],
      );
      expect(h.scans.update.mock.invocationCallOrder[0]).toBeLessThan(
        h.updateScan.mock.invocationCallOrder[0],
      );
    });

    it("the error is the first failed container's, when another failed before", async () => {
      const h = harness();
      h.firstFailed.current = {
        id: OTHER,
        outcomeReason: 'CLUSTER_TOOL_FAILED',
      };
      await h.service.closeContainer(
        request({
          status: 'failed',
          errorCode: 'CLUSTER_IMAGE_INCOMPATIBLE',
          findingsCount: 0,
        }),
      );
      expect(
        (
          h.scans.update.mock.calls[0] as unknown as [
            unknown,
            { errorCode: number },
          ]
        )[1].errorCode,
      ).toBe(85);
    });

    it('keeps the error the close already wrote, even when two failures share the same second', async () => {
      const h = harness();
      h.scans.update.mockImplementation(
        async (_where: unknown, columns: Record<string, unknown>) => {
          h.scanState.current = { ...h.scanState.current, ...columns };
          return { affected: 1 };
        },
      );
      h.updateScan.mockImplementationOnce(async () => {
        h.scanState.current = { ...h.scanState.current, state: 'failed' };
        // finishedAt has a one-second precision: once this container is
        // closed too, the lookup of the first failure may return either.
        h.firstFailed.current = {
          id: OTHER,
          outcomeReason: 'CLUSTER_TOOL_FAILED',
        };
        return { success: true, message: 'ok' };
      });
      await h.service.closeContainer(
        request({
          status: 'failed',
          errorCode: 'CLUSTER_IMAGE_INCOMPATIBLE',
          findingsCount: 0,
        }),
      );
      expect(h.scanState.current.errorCode).toBe(84);
      expect(h.scans.update).toHaveBeenCalledTimes(1);
    });

    it('a completion writes no scan error', async () => {
      const h = harness();
      await h.service.closeContainer(request());
      expect(h.scans.update).not.toHaveBeenCalled();
    });

    it('is idempotent on a closed container: no write, the object deleted again', async () => {
      const h = harness({ container: { status: 'completed' } });
      await expect(h.service.closeContainer(request())).resolves.toEqual({
        success: true,
        message: 'Container already completed',
      });
      expect(h.updateScan).not.toHaveBeenCalled();
      expect(h.containers.update).not.toHaveBeenCalled();
      expect(h.files.deleteImportObject).toHaveBeenCalledWith('p1', KEY);
    });

    it("the sca container's close deletes its SBOM object with its SARIF, completed or failed", async () => {
      for (const over of [
        {},
        {
          status: 'failed',
          errorCode: 'IMPORT_INVALID_SBOM',
          findingsCount: 0,
        },
      ]) {
        const h = harness(SCA);
        await h.service.closeContainer(request(over));
        expect(h.files.deleteImportObject.mock.calls).toEqual([
          ['p1', KEY],
          ['p1', SBOM_KEY],
        ]);
      }
    });

    it('the sca container already closed (the watchdog) deletes its SBOM again too', async () => {
      const h = harness({
        ...SCA,
        container: { ...SCA.container, status: 'failed' },
      });
      await h.service.closeContainer(request());
      expect(h.files.deleteImportObject.mock.calls).toEqual([
        ['p1', KEY],
        ['p1', SBOM_KEY],
      ]);
    });

    it('any other container deletes its SARIF only', async () => {
      const h = harness();
      await h.service.closeContainer(request());
      expect(h.files.deleteImportObject.mock.calls).toEqual([['p1', KEY]]);
    });

    it('refuses a bad status or code before any write', async () => {
      const h = harness();
      for (const over of [
        { status: 'running' },
        { status: 'failed', errorCode: '' },
        { status: 'failed', errorCode: 'boom' },
        { containerId: 'not-a-uuid' },
      ]) {
        const e = await h.service
          .closeContainer(request(over))
          .catch((x: unknown) => x);
        expect(rpc(e).code).toBe(status.INVALID_ARGUMENT);
      }
      expect(h.updateScan).not.toHaveBeenCalled();
    });

    it('an unknown container is NOT_FOUND', async () => {
      const h = harness({ container: null });
      const e = await h.service
        .closeContainer(request())
        .catch((x: unknown) => x);
      expect(rpc(e).code).toBe(status.NOT_FOUND);
    });

    it('refuses a container that is not a Community cluster container', async () => {
      const h = harness({ container: { image: 'example-sast-scanner' } });
      const e = await h.service
        .closeContainer(request())
        .catch((x: unknown) => x);
      expect(rpc(e)).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'NOT_A_CLUSTER_CONTAINER',
      });
      expect(h.updateScan).not.toHaveBeenCalled();
    });
  });
});

// The storage address is the self-hosting operator's own setting, worth
// naming; any other edition's storage host is internal and never shown.
describe('clusterFailureMessage', () => {
  const URL_ = 'http://user:pw@storage.example.test:9000/bucket';

  it('names the storage origin in the Community Edition', () => {
    const message = clusterFailureMessage(88, URL_, 'community');
    expect(message).toMatch(/http:\/\/storage\.example\.test:9000$/);
    expect(message).not.toMatch(/pw|bucket/);
  });

  it.each(['cloud', 'enterprise'] as const)(
    'never names a storage host in the %s edition: the sentence alone',
    (edition) => {
      expect(clusterFailureMessage(88, URL_, edition)).toBeUndefined();
    },
  );

  it('adds nothing to another code, or without an address', () => {
    expect(clusterFailureMessage(87, URL_, 'community')).toBeUndefined();
    expect(clusterFailureMessage(88, undefined, 'community')).toBeUndefined();
    expect(clusterFailureMessage(88, 'not a url', 'community')).toBeUndefined();
  });
});

describe('container failure names', () => {
  it('every cluster code the watchdog writes has a CLUSTER_ name that maps back to it', () => {
    for (const code of [60, 61, 63, 80, 81, 82, 83, 84, 85, 86, 87, 88]) {
      const name = clusterFailureName(code);
      expect(name).toMatch(/^CLUSTER_[A-Z_]{1,40}$/);
      expect(containerFailureCode(name)).toBe(code);
    }
  });

  // 66 is the Git provider's fetch failure: a cluster pod never writes it.
  it('a code with no name is refused', () => {
    expect(() => clusterFailureName(66)).toThrow();
    expect(() => clusterFailureName(89)).toThrow();
  });
});
