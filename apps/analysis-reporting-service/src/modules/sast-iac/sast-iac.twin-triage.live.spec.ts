import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';
import {
  ScanAddResultRequest,
  VulnerabilityDtoRequest,
} from '@grpc/analysis-reporting/result';
import { SastIacService } from './sast-iac.service';
import { SastIacUtilsService } from './sast-iac.utils';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { AutoFixRecord } from 'src/entities/autofix-record.entity';
import { VulnerabilityDetectionHistory } from 'src/entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from 'src/entities/vulnerability/correspondance-table.entity';
import { Vulnerability } from 'src/entities/vulnerability/vulnerability.entity';
import { CodeSnippet } from 'src/entities/code-snippet.entity';
import { DataFlowItem } from 'src/entities/data-flow-item.entity';
import { HistoryItem } from 'src/entities/history-item.entity';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { ResultService } from '../result/result.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { SecretEncryptionService } from 'src/core/crypto/secret-encryption.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { ScanMetaCache } from '../scan-queue/scan-meta-cache.service';
import { ScanQueueService } from '../scan-queue/scan-queue.service';

/**
 * LIVE spec: a triage decision stays on the occurrence it was taken on.
 *
 * Two occurrences of one rule with the same code in one file are twins: they
 * share every field the line-drift repair compares. A person's dismissal of
 * one of them must never move to the other one, its history must never be
 * deleted by a scan, and a new occurrence of the same code starts open even
 * when a dismissed twin already holds the identity it would have had.
 *
 * Runs on both engines with the schema of each engine's migrations, and with
 * an in-memory occurrence allocator so every new row gets the fingerprint a
 * real scan writes:
 *
 *   SAST_IAC_FINALIZE_LIVE=1 LIVE_DB_TYPE=mysql SAST_IAC_FINALIZE_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=sast-iac.twin-triage.live --runInBand
 *   SAST_IAC_FINALIZE_LIVE=1 LIVE_DB_TYPE=postgres SAST_IAC_FINALIZE_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --testPathPatterns=sast-iac.twin-triage.live --runInBand
 */
const LIVE = liveEnabled('SAST_IAC_FINALIZE');
const describeLive = LIVE ? describe : describe.skip;

const CONTENT = 'acl = "public-read"';
const MANAGER = '9d7f0c1e-0000-4000-8000-00000000a11c';
const REASON = 'accepted risk for this line only';

describeLive('SAST/IaC triage of twin occurrences', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let service: SastIacService;

  const repo = <T extends ObjectLiteral>(entity: EntityTarget<T>) =>
    dataSource.getRepository(entity);

  const finding = (path: string, line: number): VulnerabilityDtoRequest =>
    ({
      ruleId: 'CKV_TWIN_1',
      language: 'terraform',
      cwe: [],
      owaspTop10: [],
      name: 'CKV_TWIN_1',
      description: '',
      severity: 'HIGH',
      confidence: 'HIGH',
      path,
      codeSnippet: {
        vulnerableStartLine: line,
        vulnerableEndLine: line,
        startLine: line,
        endLine: line,
        code: [{ line, content: CONTENT }],
        language: 'terraform',
        path,
      },
      dataFlow: [],
      inlineIgnores: [],
    }) as VulnerabilityDtoRequest;

  /** One whole scan: one batch, then the finalization. */
  const scan = async (
    projectId: string,
    scanId: string,
    lines: number[],
  ): Promise<void> => {
    await service.processSastIacBatch({
      projectId,
      scanId,
      scannerName: 'checkov',
      vulnerabilityType: 'CRITICAL,HIGH,MEDIUM,LOW',
      vulnerabilities: lines.map((line) => finding('main.tf', line)),
      isLastRequest: false,
    } as ScanAddResultRequest);
    await service.finalizeScan(projectId, scanId, 'checkov');
  };

  const rowsOf = (projectId: string) =>
    repo(IacVulnerabilityDetections).find({
      where: { projectId },
      order: { vulnerableStartLine: 'ASC' },
    });

  const statusHistoryOf = async (detectionId: string) =>
    (
      await repo(HistoryItem).find({
        where: { iacVulnerabilityDetection: { id: detectionId } },
      })
    ).map((h) => [h.type, h.value, h.userId]);

  /** A team manager dismisses one occurrence, with a reason, as the API does. */
  const dismiss = async (detection: IacVulnerabilityDetections) => {
    const at = new Date();
    await repo(IacVulnerabilityDetections).update(
      { id: detection.id },
      {
        currentState: 'ignored',
        stateManuallyModified: true,
        triagedAt: at,
        triagedBy: MANAGER,
        triagedByType: 'user',
        dismissalReason: REASON,
      },
    );
    await repo(HistoryItem).save(
      repo(HistoryItem).create({
        type: 'status_change',
        value: 'ignored',
        date: at,
        userId: MANAGER,
        iacVulnerabilityDetection: { id: detection.id },
      } as Partial<HistoryItem>),
    );
  };

  /** Moves one row `days` back, as a later scan sees it. */
  const age = async (id: string, days: number) => {
    const createdAt = new Date(Date.now() - days * 86_400_000);
    await repo(IacVulnerabilityDetections).update({ id }, { createdAt });
  };

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'ar_twin_triage',
      envPrefix: 'SAST_IAC_FINALIZE',
      migrations: 'track',
    });
    dataSource = live.dataSource;

    const vulnerability = await repo(Vulnerability).save(
      repo(Vulnerability).create({
        name: 'Public bucket',
        shortDescription: '',
        description: '',
        howToPrevent: '',
        severity: 'HIGH',
        language: 'terraform',
        vulnerabilityType: 'iac',
        code: 'CD-IAC-9951',
      }),
    );
    await repo(CorrespondanceTable).save(
      repo(CorrespondanceTable).create({
        scanner: 'checkov',
        ruleId: 'CKV_TWIN_1',
        vulnerabilityType: 'iac',
        enabled: true,
        vulnerability,
      }),
    );

    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const redisStore = new Map<string, string>();
    // The occurrence allocator, in memory: one counter per (scan, scanner,
    // group), handed out in the order the batch gives (ascending line).
    const counters = new Map<string, number>();
    const scanQueue = {
      getRedisClient: async () => ({
        get: async (key: string) => redisStore.get(key) ?? null,
        set: async (key: string, value: string) => {
          redisStore.set(key, value);
          return 'OK';
        },
      }),
      allocateOccurrenceIndexes: async (
        _queue: string,
        scanId: string,
        scanner: string,
        entries: { groupKey: string }[],
      ) =>
        entries.map((e) => {
          const key = `${scanId}|${scanner}|${e.groupKey}`;
          const next = counters.get(key) ?? 0;
          counters.set(key, next + 1);
          return next;
        }),
      acquireDetectionCreationLock: async () => randomUUID(),
      releaseDetectionCreationLock: async () => true,
    };
    const scanMetaCache = new ScanMetaCache(
      scanQueue as unknown as ScanQueueService,
    );

    const module = await Test.createTestingModule({
      providers: [
        SastIacService,
        SastIacUtilsService,
        ...[
          SastVulnerabilityDetections,
          IacVulnerabilityDetections,
          CicdVulnerabilityDetections,
          SecretVulnerabilityDetections,
          ScaVulnerabilityDetections,
          AutoFixRecord,
          VulnerabilityDetectionHistory,
          CorrespondanceTable,
          CodeSnippet,
          DataFlowItem,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: dataSource.getRepository(entity),
        })),
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: (item: HistoryItem) =>
              dataSource.getRepository(HistoryItem).save(item),
            computeEnvironmentalForProject: async () => null,
            recalculatePriority: async () => ({
              priority: 'high',
              priorityScore: 60,
            }),
          },
        },
        {
          provide: IssueIntegrationService,
          useValue: { closeIssuesForResolvedVulnerabilities: async () => {} },
        },
        {
          provide: CvssCalculatorService,
          useValue: new CvssCalculatorService(),
        },
        { provide: CvssExplainerService, useValue: {} },
        { provide: SecretEncryptionService, useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: async () => {} },
        },
        { provide: SecurityContextCacheService, useValue: {} },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        { provide: Logger, useValue: logger },
        { provide: ScanMetaCache, useValue: scanMetaCache },
        { provide: ScanQueueService, useValue: scanQueue },
      ],
    }).compile();

    service = module.get(SastIacService);
    (service as unknown as { scanServiceClient: unknown }).scanServiceClient = {
      getScan: jest.fn(() => of({ branch: 'main', isDiffScan: false })),
    };
  });

  afterAll(async () => {
    await live?.drop();
  });

  it.each([
    ['the dismissed twin is the older row', 20, 10, true],
    ['the dismissed twin is the newer row', 20, 10, false],
    ['the dismissed twin is above the live one', 7, 140, true],
    ['the dismissed twin is above the live one, newer', 7, 140, false],
  ])(
    'a dismissal stays on its occurrence when that occurrence goes away (%s)',
    async (_case, dismissedLine, liveLine, dismissedIsOlder) => {
      const projectId = randomUUID();
      await scan(
        projectId,
        `${projectId}-1`,
        [10, 20, 7, 140].filter((l) => l === dismissedLine || l === liveLine),
      );
      const before = await rowsOf(projectId);
      expect(before).toHaveLength(2);
      const dismissed = before.find(
        (r) => r.vulnerableStartLine === dismissedLine,
      );
      const twin = before.find((r) => r.vulnerableStartLine === liveLine);
      await dismiss(dismissed);
      await age(dismissed.id, dismissedIsOlder ? 2 : 1);
      await age(twin.id, dismissedIsOlder ? 1 : 2);

      // The dismissed line is deleted from the code; its twin is untouched.
      await scan(projectId, `${projectId}-2`, [liveLine]);

      const after = await rowsOf(projectId);
      const liveRow = after.find((r) => r.id === twin.id);
      expect(liveRow).toBeDefined();
      expect(liveRow.currentState).toBe('to_verify');
      expect(liveRow.vulnerableStartLine).toBe(liveLine);
      expect(liveRow.triagedBy ?? null).toBeNull();
      expect(liveRow.dismissalReason ?? null).toBeNull();

      const dismissedRow = after.find((r) => r.id === dismissed.id);
      expect(dismissedRow).toBeDefined();
      expect(dismissedRow.currentState).toBe('ignored');
      expect(dismissedRow.vulnerableStartLine).toBe(dismissedLine);
      expect(dismissedRow.triagedBy).toBe(MANAGER);
      expect(dismissedRow.dismissalReason).toBe(REASON);
      expect(await statusHistoryOf(dismissed.id)).toEqual([
        ['status_change', 'ignored', MANAGER],
      ]);
    },
  );

  it.each([
    ['the new line reported first', [10, 20]],
    ['the dismissed line reported first', [20, 10]],
  ])(
    'a new occurrence above a dismissed twin is opened, and never inherits the dismissal (%s)',
    async (_case, secondScanLines) => {
      for (let round = 0; round < 3; round += 1) {
        const projectId = randomUUID();
        await scan(projectId, `${projectId}-1`, [20]);
        const [dismissed] = await rowsOf(projectId);
        await dismiss(dismissed);
        await age(dismissed.id, 2);

        // The same vulnerable code is added above the dismissed line. Two
        // identical occurrences now exist and nothing tells which one was
        // reviewed: both are open, the dismissal stays in the history.
        await scan(projectId, `${projectId}-2`, secondScanLines);
        const afterAdd = await rowsOf(projectId);
        expect(
          afterAdd.map((r) => [r.vulnerableStartLine, r.currentState]),
        ).toEqual([
          [10, 'to_verify'],
          [20, 'to_verify'],
        ]);
        expect(afterAdd.find((r) => r.vulnerableStartLine === 20).id).toBe(
          dismissed.id,
        );
        const opened = afterAdd.find((r) => r.vulnerableStartLine === 10);
        // The new occurrence has an identity of its own, distinct from the
        // one the dismissed row holds, so every consumer of findings sees it.
        expect(opened.fingerprint).toBeTruthy();
        expect(opened.fingerprint).not.toBe(dismissed.fingerprint);

        // The dismissed line is then deleted.
        await scan(projectId, `${projectId}-3`, [10]);
        const afterRemove = await rowsOf(projectId);
        const stillOpen = afterRemove.find((r) => r.id === opened.id);
        expect(stillOpen.currentState).toBe('to_verify');
        expect(stillOpen.fingerprint).toBe(opened.fingerprint);
        expect(stillOpen.vulnerableStartLine).toBe(10);
        expect(stillOpen.triagedBy ?? null).toBeNull();
        const kept = afterRemove.find((r) => r.id === dismissed.id);
        expect(kept.currentState).toBe('resolved');
        expect(kept.vulnerableStartLine).toBe(20);
        expect(await statusHistoryOf(dismissed.id)).toEqual(
          expect.arrayContaining([
            ['status_change', 'ignored', MANAGER],
            ['status_change', 'to_verify', null],
          ]),
        );
      }
    },
  );

  it('new identical code placed at the dismissed line never inherits the dismissal', async () => {
    for (let round = 0; round < 3; round += 1) {
      const projectId = randomUUID();
      await scan(projectId, `${projectId}-1`, [20]);
      const [dismissed] = await rowsOf(projectId);
      await dismiss(dismissed);
      await age(dismissed.id, 2);

      // The same call is inserted directly above: the new code now sits at
      // line 20 and the reviewed code at line 21.
      await scan(projectId, `${projectId}-2`, [20, 21]);
      const afterInsert = await rowsOf(projectId);
      expect(
        afterInsert.map((r) => [r.vulnerableStartLine, r.currentState]),
      ).toEqual([
        [20, 'to_verify'],
        [21, 'to_verify'],
      ]);

      // Line 21 is deleted: the new code alone remains, and stays open.
      await scan(projectId, `${projectId}-3`, [20]);
      const afterDelete = await rowsOf(projectId);
      const at20 = afterDelete.filter((r) => r.vulnerableStartLine === 20);
      expect(at20.map((r) => r.currentState)).toEqual(['to_verify']);
      expect(afterDelete.some((r) => r.currentState === 'ignored')).toBe(false);
      // The dismissal is kept in the history, followed by the reopen.
      expect(await statusHistoryOf(dismissed.id)).toEqual(
        expect.arrayContaining([
          ['status_change', 'ignored', MANAGER],
          ['status_change', 'to_verify', null],
        ]),
      );
    }
  });

  // Line 10 is deleted, so the code of line 20 moves up to line 19 and both
  // old rows vanish from their lines. Which row takes line 19 must never
  // depend on the order the rows come back from the database, and line 19
  // must never end up hidden under a dismissal taken on other code.
  it.each([
    ['the upper twin is dismissed', 10],
    ['the lower twin is dismissed', 20],
  ])(
    'the occurrence shifted by a deleted twin is never hidden under a dismissal, whatever the row order (%s)',
    async (_case, dismissedLine) => {
      for (let round = 0; round < 4; round += 1) {
        const projectId = randomUUID();
        await scan(projectId, `${projectId}-1`, [10, 20]);
        const before = await rowsOf(projectId);
        const dismissed = before.find(
          (r) => r.vulnerableStartLine === dismissedLine,
        );
        const other = before.find(
          (r) => r.vulnerableStartLine !== dismissedLine,
        );
        await dismiss(dismissed);
        // Both orders of creation, so both orders of the rows.
        await age(dismissed.id, round % 2 === 0 ? 2 : 1);
        await age(other.id, round % 2 === 0 ? 1 : 2);

        await scan(projectId, `${projectId}-2`, [19]);

        const after = await rowsOf(projectId);
        const at19 = after.filter((r) => r.vulnerableStartLine === 19);
        expect(at19).toHaveLength(1);
        if (dismissedLine === 10) {
          // The live occurrence is the row that was at line 20: it stays
          // open, and the dismissed row stays as it was, on its own line.
          expect(at19[0].id).toBe(other.id);
          expect(at19[0].currentState).toBe('to_verify');
          const kept = after.find((r) => r.id === dismissed.id);
          expect(kept.currentState).toBe('ignored');
          expect(kept.vulnerableStartLine).toBe(10);
        } else if (at19[0].id === dismissed.id) {
          // The dismissed row is the one that moved, by one line: the only
          // pairing it may take.
          expect(at19[0].currentState).toBe('ignored');
          expect(after.find((r) => r.id === other.id).currentState).toBe(
            'resolved',
          );
        } else {
          // Or the identity the scan computed went to the undecided row:
          // line 19 is open, the dismissal stays on the row it was taken on.
          expect(at19[0].id).toBe(other.id);
          expect(at19[0].currentState).toBe('to_verify');
          expect(after.find((r) => r.id === dismissed.id).currentState).toBe(
            'ignored',
          );
        }
        expect(await statusHistoryOf(dismissed.id)).toEqual(
          expect.arrayContaining([['status_change', 'ignored', MANAGER]]),
        );
      }
    },
  );

  it('the dismissed twin stays dismissed when the live one is deleted', async () => {
    for (let round = 0; round < 4; round += 1) {
      const projectId = randomUUID();
      await scan(projectId, `${projectId}-1`, [10, 20]);
      const before = await rowsOf(projectId);
      const dismissed = before.find((r) => r.vulnerableStartLine === 10);
      const live = before.find((r) => r.vulnerableStartLine === 20);
      await dismiss(dismissed);
      await age(dismissed.id, round % 2 === 0 ? 2 : 1);
      await age(live.id, round % 2 === 0 ? 1 : 2);

      await scan(projectId, `${projectId}-2`, [10]);

      const after = await rowsOf(projectId);
      expect(
        after.map((r) => [r.id, r.vulnerableStartLine, r.currentState]),
      ).toEqual([
        [dismissed.id, 10, 'ignored'],
        [live.id, 20, 'resolved'],
      ]);
    }
  });

  it('a dismissed finding whose code only moved keeps its dismissal and its history', async () => {
    const projectId = randomUUID();
    await scan(projectId, `${projectId}-1`, [20]);
    const [dismissed] = await rowsOf(projectId);
    await dismiss(dismissed);
    await age(dismissed.id, 2);

    // Five lines were added above: the same code now sits at line 25.
    await scan(projectId, `${projectId}-2`, [25]);

    const rows = await rowsOf(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(dismissed.id);
    expect(rows[0].vulnerableStartLine).toBe(25);
    expect(rows[0].currentState).toBe('ignored');
    expect(rows[0].dismissalReason).toBe(REASON);
    expect(await statusHistoryOf(dismissed.id)).toEqual([
      ['status_change', 'ignored', MANAGER],
    ]);
  });
});
