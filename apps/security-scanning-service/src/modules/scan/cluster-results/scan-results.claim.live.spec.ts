import { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { ClientGrpc } from '@nestjs/microservices';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { map, of, throwError, timer } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { Container } from 'src/entities/container.entity';
import { Scan } from 'src/entities/scan.entity';
import { Scanner } from 'src/entities/scanner.entity';
import { ScanUploadToken } from 'src/entities/scan-upload-token.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import type { FileManagementService } from '../../file/file-management.service';
import { readClusterScanningConfig } from '../../cluster-scanning/cluster-scanning.config';
import {
  COMMUNITY_SCANNER_CATALOGUE,
  CommunityScannerCatalogue,
} from '../../cluster-scanning/scanner-catalogue';
import { importObjectKey } from '../import/import-object-key';
import { hashScanToken, ScanUploadTokens } from './scan-upload-tokens';
import { ScanResultsService } from './scan-results.service';

/**
 * LIVE proof of the single claim of SubmitScanResults
 * on BOTH engines (`LIVE_DB_TYPE=mysql|postgres`): two concurrent submits of
 * one container's token (a runner retrying after a lost answer) import once;
 * the other answers ALREADY_EXISTS SCAN_RESULTS_ALREADY_SUBMITTED. An
 * ImportResults that fails after the claim gives the token back: the retry claims again and is accepted.
 *
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=mysql SS_IMPORT_SCAN_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand src/modules/scan/cluster-results/scan-results.claim.live.spec.ts
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=postgres DB_TYPE=postgres SS_IMPORT_SCAN_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/scan/cluster-results/scan-results.claim.live.spec.ts
 */
const describeLive = liveEnabled('SS_CLUSTER_SCAN') ? describe : describe.skip;

describeLive('SubmitScanResults on a real database', () => {
  jest.setTimeout(300_000);

  let db: LiveDatabase;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    process.env.SS_CLUSTER_SCAN_MYSQL_URL ??=
      process.env.SS_IMPORT_SCAN_MYSQL_URL;
    process.env.SS_CLUSTER_SCAN_PG_URL ??= process.env.SS_IMPORT_SCAN_PG_URL;
    db = await createLiveDatabase({
      prefix: 'ss_cluster_results',
      envPrefix: 'SS_CLUSTER_SCAN',
    });
    await new CommunityScannerCatalogue(
      db.dataSource.getRepository(Scanner),
      readClusterScanningConfig({
        CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/k',
        CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
        FRONTEND_URL: 'https://a.example',
      }),
    ).seed();
  });

  afterAll(async () => {
    await db?.drop();
    jest.restoreAllMocks();
  });

  it('two concurrent submits: one import', async () => {
    const scan = await db.dataSource.getRepository(Scan).save({
      name: 'community-scan',
      language: [],
      projectId: 'p1',
      organizationId: 'o1',
      state: 'running',
      branch: 'main',
    });
    const containerId = uuidv4();
    const zizmor = COMMUNITY_SCANNER_CATALOGUE[1];
    await db.dataSource.getRepository(Container).insert({
      id: containerId,
      podName: `cd-scan-zizmor-${containerId}`,
      image: 'cybedefend-scanners/zizmor:1.0.0',
      status: 'starting',
      scanId: scan.id,
      scanner: { id: zizmor.id } as Scanner,
    });
    const tokens = new ScanUploadTokens(
      db.dataSource.getRepository(ScanUploadToken),
    );
    const token = await tokens.mint({
      scanId: scan.id,
      containerId,
      category: 'cicd',
      severities: 'high,low',
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    // A slow ImportResults widens the window between the two submits.
    const importResults = jest.fn(() =>
      timer(200).pipe(map(() => ({ accepted: true }))),
    );
    const service = new ScanResultsService(
      tokens,
      db.dataSource.getRepository(Scan),
      db.dataSource.getRepository(Container),
      {
        deleteImportObject: jest.fn(async () => undefined),
      } as unknown as FileManagementService,
      { getService: () => ({ importResults }) } as unknown as ClientGrpc,
      { get: jest.fn() } as unknown as ModuleRef,
    );
    service.onModuleInit();

    // Both submits pass their token check before either claims: the claim's
    // conditional UPDATE, not an earlier read, decides which one imports.
    const realClaim = tokens.claim.bind(tokens) as ScanUploadTokens['claim'];
    let arrived = 0;
    let release: () => void = () => undefined;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    const claim = jest
      .spyOn(tokens, 'claim')
      .mockImplementation(
        async (...args: Parameters<ScanUploadTokens['claim']>) => {
          arrived += 1;
          if (arrived === 2) release();
          await bothArrived;
          return realClaim(...args);
        },
      );

    const request = {
      scanId: scan.id,
      tokenHash: hashScanToken(token),
      objectKey: importObjectKey('p1', scan.id, containerId),
    };
    const outcomes = await Promise.allSettled([
      service.submit(request),
      service.submit(request),
    ]);

    expect(importResults).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(2);
    const claimAnswers = await Promise.all(
      claim.mock.results.map(
        (r) => r.value as ReturnType<ScanUploadTokens['claim']>,
      ),
    );
    expect(claimAnswers.filter((a) => a === 'used')).toHaveLength(1);
    expect(claimAnswers.filter((a) => a === 'claimed')).toHaveLength(1);
    claim.mockRestore();
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected',
    );
    expect(fulfilled).toEqual([
      { status: 'fulfilled', value: { accepted: true } },
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(RpcException);
    expect((rejected[0].reason as RpcException).getError()).toEqual({
      code: status.ALREADY_EXISTS,
      message: 'SCAN_RESULTS_ALREADY_SUBMITTED',
    });

    // a third, later submit is told the same
    await expect(service.submit(request)).rejects.toMatchObject({
      error: { code: status.ALREADY_EXISTS },
    });
    const row = await db.dataSource
      .getRepository(ScanUploadToken)
      .findOneByOrFail({ containerId });
    expect(row.usedAt).toBeInstanceOf(Date);
  });

  it('an ImportResults outage after the claim gives the token back: the retry is accepted, the container stays open', async () => {
    const scan = await db.dataSource.getRepository(Scan).save({
      name: 'community-scan',
      language: [],
      projectId: 'p1',
      organizationId: 'o1',
      state: 'running',
      branch: 'main',
    });
    const containerId = uuidv4();
    await db.dataSource.getRepository(Container).insert({
      id: containerId,
      podName: `cd-scan-zizmor-${containerId}`,
      image: 'cybedefend-scanners/zizmor:1.0.0',
      status: 'running',
      scanId: scan.id,
      scanner: { id: COMMUNITY_SCANNER_CATALOGUE[1].id } as Scanner,
    });
    const tokens = new ScanUploadTokens(
      db.dataSource.getRepository(ScanUploadToken),
    );
    const token = await tokens.mint({
      scanId: scan.id,
      containerId,
      category: 'cicd',
      severities: 'high,low',
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const importResults = jest
      .fn()
      .mockReturnValueOnce(throwError(() => ({ code: status.UNAVAILABLE })))
      .mockReturnValueOnce(of({ accepted: true }));
    const deleteImportObject = jest.fn(async () => undefined);
    const updateScan = jest.fn();
    const service = new ScanResultsService(
      tokens,
      db.dataSource.getRepository(Scan),
      db.dataSource.getRepository(Container),
      { deleteImportObject } as unknown as FileManagementService,
      { getService: () => ({ importResults }) } as unknown as ClientGrpc,
      { get: jest.fn(() => ({ updateScan })) } as unknown as ModuleRef,
    );
    service.onModuleInit();
    const request = {
      scanId: scan.id,
      tokenHash: hashScanToken(token),
      objectKey: importObjectKey('p1', scan.id, containerId),
    };

    await expect(service.submit(request)).rejects.toMatchObject({
      error: { code: status.UNAVAILABLE, message: 'IMPORT_UNAVAILABLE' },
    });
    const given = await db.dataSource
      .getRepository(ScanUploadToken)
      .findOneByOrFail({ containerId });
    expect(given.usedAt).toBeNull();

    await expect(service.submit(request)).resolves.toEqual({ accepted: true });
    expect(importResults).toHaveBeenCalledTimes(2);
    const spent = await db.dataSource
      .getRepository(ScanUploadToken)
      .findOneByOrFail({ containerId });
    expect(spent.usedAt).toBeInstanceOf(Date);
    const row = await db.dataSource
      .getRepository(Container)
      .findOneByOrFail({ id: containerId });
    expect(row.status).toBe('running');
    expect(row.outcomeReason ?? null).toBeNull();
    expect(updateScan).not.toHaveBeenCalled();
    expect(deleteImportObject).not.toHaveBeenCalled();
  });
});
