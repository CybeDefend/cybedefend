import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ScanQueueService } from './scan-queue.service';
import { QUEUE_NAMES } from './queue-names';

// The enqueueAgentReanalysis idempotence cases and the SCA AutoFix cases
// (KEDA backlog list, stale-job eviction, dedup and cap) are in closed specs.
describe('ScanQueueService – report and batch-update jobs', () => {
  let service: ScanQueueService;
  let reportsQueue: { add: jest.Mock; client: Promise<unknown> };
  let aggregatedReportsQueue: { add: jest.Mock; client: Promise<unknown> };
  let vulnBatchUpdateQueue: { add: jest.Mock; client: Promise<unknown> };
  let resultsImportQueue: { add: jest.Mock; client: Promise<unknown> };

  beforeEach(async () => {
    resultsImportQueue = {
      add: jest.fn().mockResolvedValue({ id: 'results-import-scan-9' }),
      client: Promise.resolve({ duplicate: () => ({}) }),
    };
    reportsQueue = {
      add: jest.fn().mockResolvedValue({ id: 'report-rep-1' }),
      client: Promise.resolve({ duplicate: () => ({}) }),
    };
    aggregatedReportsQueue = {
      add: jest.fn().mockResolvedValue({ id: 'aggregated-report-rep-1' }),
      client: Promise.resolve({ duplicate: () => ({}) }),
    };
    vulnBatchUpdateQueue = {
      add: jest.fn().mockResolvedValue({ id: 'vuln-batch-update-task-42' }),
      client: Promise.resolve({ duplicate: () => ({}) }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ScanQueueService,
        {
          provide: getQueueToken(QUEUE_NAMES.SCA),
          useValue: { client: Promise.resolve({ duplicate: () => ({}) }) },
        },
        {
          provide: getQueueToken(QUEUE_NAMES.SAST_IAC),
          useValue: { client: Promise.resolve({ duplicate: () => ({}) }) },
        },
        {
          provide: getQueueToken(QUEUE_NAMES.CONTAINER),
          useValue: { client: Promise.resolve({ duplicate: () => ({}) }) },
        },
        {
          provide: getQueueToken(QUEUE_NAMES.CVSS_RECALCULATION),
          useValue: { client: Promise.resolve({ duplicate: () => ({}) }) },
        },
        {
          provide: getQueueToken(QUEUE_NAMES.CYBERISK_RECOMPUTE),
          useValue: { client: Promise.resolve({ duplicate: () => ({}) }) },
        },
        {
          provide: getQueueToken(QUEUE_NAMES.REPORTS),
          useValue: reportsQueue,
        },
        {
          provide: getQueueToken(QUEUE_NAMES.AGGREGATED_REPORTS),
          useValue: aggregatedReportsQueue,
        },
        {
          provide: getQueueToken(QUEUE_NAMES.VULN_BATCH_UPDATE),
          useValue: vulnBatchUpdateQueue,
        },
        {
          provide: getQueueToken(QUEUE_NAMES.RESULTS_IMPORT),
          useValue: resultsImportQueue,
        },
      ],
    }).compile();

    service = moduleRef.get(ScanQueueService);
  });

  describe('addReportJob', () => {
    it('enqueues a deterministic report job keyed by reportId with no retry', async () => {
      const jobId = await service.addReportJob({
        reportId: 'rep-1',
        kind: 'owasp',
        projectId: 'proj-1',
        format: 'pdf',
        detailed: true,
        branch: 'main',
      });

      expect(jobId).toBe('report-rep-1');
      expect(reportsQueue.add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = reportsQueue.add.mock.calls[0];
      expect(name).toBe('generate-report');
      expect(data).toMatchObject({
        reportId: 'rep-1',
        kind: 'owasp',
        projectId: 'proj-1',
        format: 'pdf',
        detailed: true,
        branch: 'main',
      });
      // Deterministic jobId dedupes a double-enqueue; failure is terminal.
      expect(opts.jobId).toBe('report-rep-1');
      expect(opts.attempts).toBe(1);
    });

    it('carries scannerTypes for scanner-type reports', async () => {
      await service.addReportJob({
        reportId: 'rep-2',
        kind: 'scanner_type',
        projectId: 'proj-1',
        format: 'pdf',
        detailed: false,
        scannerTypes: ['sast', 'sca'],
      });

      const [, data] = reportsQueue.add.mock.calls[0];
      expect(data.scannerTypes).toEqual(['sast', 'sca']);
    });
  });

  describe('addResultsImportJob', () => {
    it('adds a results-import job with attempts 1 and jobId results-import-<scanId>', async () => {
      const data = {
        scanId: 'scan-9',
        projectId: 'proj-1',
        organizationId: 'org-1',
        branch: 'main',
        category: 'sast' as const,
        format: 'sarif' as const,
        fileKey: 'import/proj-1/scan-9.sarif',
      };

      const jobId = await service.addResultsImportJob(data);

      expect(jobId).toBe('results-import-scan-9');
      expect(resultsImportQueue.add).toHaveBeenCalledTimes(1);
      const [name, jobData, opts] = resultsImportQueue.add.mock.calls[0];
      expect(name).toBe('import-results');
      expect(jobData).toEqual(data);
      expect(opts).toMatchObject({
        jobId: 'results-import-scan-9',
        attempts: 1,
        priority: 1,
      });
    });
  });

  describe('addResultsImportJob per scanner container (Community cluster scans)', () => {
    it('keys the job results-import-<scanId>-<containerId> and keeps the container and severities in the data', async () => {
      resultsImportQueue.add.mockResolvedValueOnce({
        id: 'results-import-scan-9-c-1',
      });
      const data = {
        scanId: 'scan-9',
        projectId: 'proj-1',
        organizationId: 'org-1',
        branch: 'main',
        category: 'sca' as const,
        format: 'sarif' as const,
        fileKey: 'import/proj-1/scan-9/c-1.sarif',
        containerId: 'c-1',
        severities: 'critical,high',
      };

      const jobId = await service.addResultsImportJob(data);

      expect(jobId).toBe('results-import-scan-9-c-1');
      const [name, jobData, opts] = resultsImportQueue.add.mock.calls[0];
      expect(name).toBe('import-results');
      expect(jobData).toEqual(data);
      expect(opts).toMatchObject({
        jobId: 'results-import-scan-9-c-1',
        attempts: 1,
        priority: 1,
      });
    });

    it('gives two containers of one scan two jobs', async () => {
      const base = {
        scanId: 'scan-9',
        projectId: 'proj-1',
        organizationId: 'org-1',
        branch: 'main',
        format: 'sarif' as const,
      };
      await service.addResultsImportJob({
        ...base,
        category: 'sast',
        fileKey: 'import/proj-1/scan-9/c-1.sarif',
        containerId: 'c-1',
      });
      await service.addResultsImportJob({
        ...base,
        category: 'secret',
        fileKey: 'import/proj-1/scan-9/c-2.sarif',
        containerId: 'c-2',
      });
      expect(
        resultsImportQueue.add.mock.calls.map(([, , opts]) => opts.jobId),
      ).toEqual(['results-import-scan-9-c-1', 'results-import-scan-9-c-2']);
    });
  });

  describe('addVulnBatchUpdateJob', () => {
    it('enqueues a job keyed by taskId with attempts=1 and returns the job id', async () => {
      const jobData = {
        taskId: 'task-42',
        projectId: 'proj-1',
        userId: 'user-1',
        items: [
          { vulnerabilityId: 'v-1', status: 'false_positive' },
          { vulnerabilityId: 'v-2', priority: 'high' },
        ],
      };

      const jobId = await service.addVulnBatchUpdateJob(jobData);

      expect(jobId).toBe('vuln-batch-update-task-42');
      expect(vulnBatchUpdateQueue.add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = vulnBatchUpdateQueue.add.mock.calls[0];
      expect(name).toBe('process-vuln-batch-update');
      expect(data).toMatchObject({
        taskId: 'task-42',
        projectId: 'proj-1',
        userId: 'user-1',
        items: jobData.items,
      });
      // Deterministic jobId dedupes accidental double-enqueue; no retry.
      expect(opts.jobId).toBe('vuln-batch-update-task-42');
      expect(opts.attempts).toBe(1);
    });

    it('passes optional agent fields through to the job data', async () => {
      await service.addVulnBatchUpdateJob({
        taskId: 'task-99',
        projectId: 'proj-2',
        userId: 'user-2',
        items: [{ vulnerabilityId: 'v-3', comment: 'fp confirmed' }],
        agentToolCallId: 'tool-call-abc',
        agentConversationId: 'conv-xyz',
        agentStreamId: 'stream-000',
      });

      const [, data] = vulnBatchUpdateQueue.add.mock.calls[0];
      expect(data.agentToolCallId).toBe('tool-call-abc');
      expect(data.agentConversationId).toBe('conv-xyz');
      expect(data.agentStreamId).toBe('stream-000');
    });
  });
});

/**
 * In-memory Redis mock supporting SET ops (sadd, scard), key-value ops
 * (set with NX, get, del), sorted sets, and expiry. Mirrors the mock used by
 * scan-complete-notification.service.spec.ts so the finalization helpers can
 * be exercised through the real getRedisClient() path.
 *
 * `eval` emulates the detection creation lock's release script. The
 * SCA AutoFix admission scripts and their cases are in a closed spec.
 */
function createRedisMock() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const zsets = new Map<string, Map<string, number>>();
  const ttls = new Map<string, number>();
  const zset = (key: string): Map<string, number> => {
    if (!zsets.has(key)) zsets.set(key, new Map());
    return zsets.get(key)!;
  };

  return {
    sadd: jest.fn(async (key: string, ...members: string[]) => {
      if (!sets.has(key)) sets.set(key, new Set());
      const s = sets.get(key)!;
      let added = 0;
      for (const m of members) {
        if (!s.has(m)) {
          s.add(m);
          added++;
        }
      }
      return added;
    }),
    scard: jest.fn(async (key: string) => sets.get(key)?.size ?? 0),
    smembers: jest.fn(async (key: string) => Array.from(sets.get(key) ?? [])),
    expire: jest.fn(async () => 1),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      const px = args.indexOf('PX');
      if (px >= 0) ttls.set(key, Number(args[px + 1]));
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const k of keys) {
        if (store.has(k) || sets.has(k)) {
          store.delete(k);
          sets.delete(k);
          deleted++;
        }
      }
      return deleted;
    }),
    incr: jest.fn(async (key: string) => {
      const val = parseInt(store.get(key) ?? '0', 10) + 1;
      store.set(key, String(val));
      return val;
    }),
    rpush: jest.fn(async (key: string, ...values: string[]) => {
      if (!sets.has(key)) sets.set(key, new Set());
      const s = sets.get(key)!;
      for (const v of values) s.add(v);
      return s.size;
    }),
    lrem: jest.fn(async (key: string, _count: number, value: string) => {
      const s = sets.get(key);
      if (!s) return 0;
      const existed = s.has(value);
      s.delete(value);
      return existed ? 1 : 0;
    }),
    llen: jest.fn(async (key: string) => sets.get(key)?.size ?? 0),
    zrange: jest.fn(
      async (
        key: string,
        _start: number,
        _stop: number,
        withScores?: string,
      ) => {
        const entries = [...(zsets.get(key) ?? new Map<string, number>())].sort(
          (a, b) => a[1] - b[1],
        );
        return withScores === 'WITHSCORES'
          ? entries.flatMap(([member, score]) => [member, String(score)])
          : entries.map(([member]) => member);
      },
    ),
    zscore: jest.fn(async (key: string, member: string) => {
      const score = zsets.get(key)?.get(member);
      return score === undefined ? null : String(score);
    }),
    zrem: jest.fn(async (key: string, ...members: string[]) => {
      const z = zsets.get(key);
      return members.filter((m) => z?.delete(m)).length;
    }),
    eval: jest.fn(
      async (
        script: string,
        _numKeys: number,
        ...args: (string | number)[]
      ) => {
        const argv = args.map(String);
        if (
          script === ScanQueueService.DETECTION_CREATION_LOCK_RELEASE_SCRIPT
        ) {
          // Compare-and-delete: only the current holder deletes the key.
          const [key, holder] = argv;
          if (store.get(key) !== holder) return 0;
          store.delete(key);
          return 1;
        }
        throw new Error('createRedisMock: unexpected EVAL script');
      },
    ),
    _store: store,
    _sets: sets,
    _zsets: zsets,
    _zset: zset,
    _ttls: ttls,
  };
}

/** Builds a ScanQueueService whose every queue shares `redisMock`. */
async function buildScanQueueService(
  redisMock: ReturnType<typeof createRedisMock>,
): Promise<ScanQueueService> {
  const client = () => Promise.resolve({ duplicate: () => redisMock });
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      ScanQueueService,
      ...Object.values(QUEUE_NAMES).map((name) => ({
        provide: getQueueToken(name),
        useValue: { client: client() },
      })),
    ],
  }).compile();

  const service = moduleRef.get(ScanQueueService);
  await service.onModuleInit();
  return service;
}

/**
 * WS-0a: shared Redis finalization helpers used by the SCA finalize gate.
 * These guarantee per-scanner finalization fires exactly once, only after ALL
 * batches for a (scanId, scanner) have completed — independent of completion
 * order or the number of queue consumers.
 */
describe('ScanQueueService – finalization gate helpers', () => {
  let service: ScanQueueService;
  let redisMock: ReturnType<typeof createRedisMock>;

  const queueStub = () => ({
    client: Promise.resolve({ duplicate: () => redisMock }),
  });

  beforeEach(async () => {
    redisMock = createRedisMock();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ScanQueueService,
        { provide: getQueueToken(QUEUE_NAMES.SCA), useValue: queueStub() },
        { provide: getQueueToken(QUEUE_NAMES.SAST_IAC), useValue: queueStub() },
        {
          provide: getQueueToken(QUEUE_NAMES.CONTAINER),
          useValue: queueStub(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.CVSS_RECALCULATION),
          useValue: queueStub(),
        },
        // The AGENT_REANALYSIS queue provider moved to the ee specs.
        {
          provide: getQueueToken(QUEUE_NAMES.CYBERISK_RECOMPUTE),
          useValue: queueStub(),
        },
        { provide: getQueueToken(QUEUE_NAMES.REPORTS), useValue: queueStub() },
        {
          provide: getQueueToken(QUEUE_NAMES.AGGREGATED_REPORTS),
          useValue: queueStub(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.VULN_BATCH_UPDATE),
          useValue: queueStub(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.RESULTS_IMPORT),
          useValue: queueStub(),
        },
      ],
    }).compile();

    service = moduleRef.get(ScanQueueService);
    await service.onModuleInit();
  });

  it('round-trips setExpectedBatches / getExpectedBatches', async () => {
    expect(await service.getExpectedBatches('sca', 's1', 'scanner')).toBeNull();

    await service.setExpectedBatches('sca', 's1', 'scanner', 3);

    expect(await service.getExpectedBatches('sca', 's1', 'scanner')).toBe(3);
    // TTL is set atomically via the EX option on SET (no separate EXPIRE).
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining(':expected'),
      '3',
      'EX',
      86400,
    );
  });

  it('markBatchCompleted returns the distinct completed count', async () => {
    expect(await service.markBatchCompleted('sca', 's1', 'scanner', 0)).toBe(1);
    expect(await service.markBatchCompleted('sca', 's1', 'scanner', 1)).toBe(2);
    expect(await service.markBatchCompleted('sca', 's1', 'scanner', 2)).toBe(3);
  });

  it('markBatchCompleted is idempotent on retry (same index does not inflate count)', async () => {
    expect(await service.markBatchCompleted('sca', 's1', 'scanner', 0)).toBe(1);
    expect(await service.markBatchCompleted('sca', 's1', 'scanner', 0)).toBe(1);
    expect(await service.getCompletedCount('sca', 's1', 'scanner')).toBe(1);
  });

  it('getCompletedCount reflects distinct batches', async () => {
    expect(await service.getCompletedCount('sca', 's1', 'scanner')).toBe(0);
    await service.markBatchCompleted('sca', 's1', 'scanner', 0);
    await service.markBatchCompleted('sca', 's1', 'scanner', 1);
    expect(await service.getCompletedCount('sca', 's1', 'scanner')).toBe(2);
  });

  it('tryAcquireFinalizeLock returns true once then false (exactly-once)', async () => {
    expect(await service.tryAcquireFinalizeLock('sca', 's1', 'scanner')).toBe(
      true,
    );
    expect(await service.tryAcquireFinalizeLock('sca', 's1', 'scanner')).toBe(
      false,
    );
    expect(await service.tryAcquireFinalizeLock('sca', 's1', 'scanner')).toBe(
      false,
    );
  });

  it('clearBatchTracking deletes expected, completedset and finalized keys', async () => {
    await service.setExpectedBatches('sca', 's1', 'scanner', 2);
    await service.markBatchCompleted('sca', 's1', 'scanner', 0);
    await service.tryAcquireFinalizeLock('sca', 's1', 'scanner');

    await service.clearBatchTracking('sca', 's1', 'scanner');

    expect(await service.getExpectedBatches('sca', 's1', 'scanner')).toBeNull();
    expect(await service.getCompletedCount('sca', 's1', 'scanner')).toBe(0);
    // Lock is gone, so it can be acquired again.
    expect(await service.tryAcquireFinalizeLock('sca', 's1', 'scanner')).toBe(
      true,
    );
  });

  // The end of a scan must wait for a
  // scanner that sent its last batch, even when its container was closed
  // failed meanwhile: its finalization is still to come.
  it('lists the scanners whose last batch arrived, until their tracking is cleared', async () => {
    expect(
      await service.getScannersAwaitingFinalization('sast-iac', 's1'),
    ).toEqual([]);

    await service.setExpectedBatches('sast-iac', 's1', 'kics', 3);
    await service.setExpectedBatches('sast-iac', 's1', 'opengrep', 1);
    await service.setExpectedBatches('sca', 's1', 'scanlink-sca', 2);

    expect(
      (await service.getScannersAwaitingFinalization('sast-iac', 's1')).sort(),
    ).toEqual(['kics', 'opengrep']);
    expect(
      await service.getScannersAwaitingFinalization('sast-iac', 's2'),
    ).toEqual([]);

    // opengrep finalized: clearBatchTracking removed its expected count.
    await service.clearBatchTracking('sast-iac', 's1', 'opengrep');
    expect(
      await service.getScannersAwaitingFinalization('sast-iac', 's1'),
    ).toEqual(['kics']);
  });

  it('keys are scoped per (scanId, scanner) and do not collide', async () => {
    await service.markBatchCompleted('sca', 's1', 'scanner-a', 0);
    await service.markBatchCompleted('sca', 's1', 'scanner-b', 0);

    expect(await service.getCompletedCount('sca', 's1', 'scanner-a')).toBe(1);
    expect(await service.getCompletedCount('sca', 's1', 'scanner-b')).toBe(1);
    expect(await service.getCompletedCount('sca', 's2', 'scanner-a')).toBe(0);
  });
});

/**
 * WS-0a: addScaJob must publish the expected batch total when enqueuing the
 * isLast job so the finalize gate knows how many batches to wait for.
 */
describe('ScanQueueService – addScaJob expected-batches publication', () => {
  let service: ScanQueueService;
  let redisMock: ReturnType<typeof createRedisMock>;
  let scaQueue: { add: jest.Mock; client: Promise<unknown> };

  const otherQueueStub = () => ({
    client: Promise.resolve({ duplicate: () => ({}) }),
  });

  beforeEach(async () => {
    redisMock = createRedisMock();
    scaQueue = {
      add: jest.fn().mockResolvedValue({ id: 'mock-sca-job' }),
      client: Promise.resolve({ duplicate: () => redisMock }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ScanQueueService,
        { provide: getQueueToken(QUEUE_NAMES.SCA), useValue: scaQueue },
        {
          provide: getQueueToken(QUEUE_NAMES.SAST_IAC),
          useValue: otherQueueStub(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.CONTAINER),
          useValue: otherQueueStub(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.CVSS_RECALCULATION),
          useValue: otherQueueStub(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.CYBERISK_RECOMPUTE),
          useValue: otherQueueStub(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.REPORTS),
          useValue: otherQueueStub(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.AGGREGATED_REPORTS),
          useValue: otherQueueStub(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.VULN_BATCH_UPDATE),
          useValue: otherQueueStub(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.RESULTS_IMPORT),
          useValue: otherQueueStub(),
        },
      ],
    }).compile();

    service = moduleRef.get(ScanQueueService);
    await service.onModuleInit();
  });

  it('does NOT set expected batches for non-last jobs', async () => {
    await service.addScaJob({
      scanId: 's1',
      projectId: 'p1',
      scannerName: 'scanlink-sca',
      isLastRequest: false,
      packages: [],
    } as any);

    expect(
      await service.getExpectedBatches('sca', 's1', 'scanlink-sca'),
    ).toBeNull();
  });

  it('sets expected batches = batchIndex + 1 when enqueuing the isLast job', async () => {
    // Two normal batches first (indices 0 and 1), then the isLast (index 2).
    await service.addScaJob({
      scanId: 's1',
      projectId: 'p1',
      scannerName: 'scanlink-sca',
      isLastRequest: false,
      packages: [],
    } as any);
    await service.addScaJob({
      scanId: 's1',
      projectId: 'p1',
      scannerName: 'scanlink-sca',
      isLastRequest: false,
      packages: [],
    } as any);
    await service.addScaJob({
      scanId: 's1',
      projectId: 'p1',
      scannerName: 'scanlink-sca',
      isLastRequest: true,
      packages: [],
    } as any);

    // 3 batches total → batchIndex of isLast is 2 → expected = 3.
    expect(await service.getExpectedBatches('sca', 's1', 'scanlink-sca')).toBe(
      3,
    );
  });
});

/**
 * The Gitleaks scanner sends the outcome of its git history pass on its last
 * batch only. The finalize gate runs later, from whichever consumer completes
 * the scanner's last batch, so the outcome waits in Redis next to the batch
 * tracking.
 */
describe('ScanQueueService – history pass outcome', () => {
  let service: ScanQueueService;
  let redisMock: ReturnType<typeof createRedisMock>;
  let sastIacQueue: { add: jest.Mock; client: Promise<unknown> };

  const batch = (over: Record<string, unknown> = {}): any => ({
    scanId: 's1',
    projectId: 'p1',
    scannerName: 'Gitleaks',
    isLastRequest: false,
    vulnerabilities: [],
    ...over,
  });

  beforeEach(async () => {
    redisMock = createRedisMock();
    sastIacQueue = {
      add: jest.fn().mockResolvedValue({ id: 'mock-sast-iac-job' }),
      client: Promise.resolve({ duplicate: () => redisMock }),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ScanQueueService,
        ...Object.values(QUEUE_NAMES).map((name) => ({
          provide: getQueueToken(name),
          useValue:
            name === QUEUE_NAMES.SAST_IAC
              ? sastIacQueue
              : { client: Promise.resolve({ duplicate: () => redisMock }) },
        })),
      ],
    }).compile();
    service = moduleRef.get(ScanQueueService);
    await service.onModuleInit();
  });

  it("the last batch's history outcome is kept for finalize", async () => {
    await service.addSastIacJob(batch());
    await service.addSastIacJob(
      batch({ isLastRequest: true, historyPassOutcome: 'failed' }),
    );

    expect(await service.getHistoryPassOutcome('s1', 'gitleaks')).toBe(
      'failed',
    );
    // The same 24 h as the expected-batch key it is read with.
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining(':history-outcome'),
      'failed',
      'EX',
      86400,
    );
  });

  it('keeps nothing from a batch that is not the last, nor a value outside ok, failed and none', async () => {
    await service.addSastIacJob(batch({ historyPassOutcome: 'ok' }));
    expect(await service.getHistoryPassOutcome('s1', 'gitleaks')).toBeNull();

    await service.addSastIacJob(
      batch({ isLastRequest: true, historyPassOutcome: 'partial' }),
    );
    expect(await service.getHistoryPassOutcome('s1', 'gitleaks')).toBeNull();
  });

  it('is stored before the expected batch count, and still enqueues the batch when Redis refuses it', async () => {
    const order: string[] = [];
    const set = redisMock.set.getMockImplementation();
    redisMock.set.mockImplementation(
      async (key: string, value: string, ...args: unknown[]) => {
        if (key.endsWith(':history-outcome')) {
          order.push('outcome');
          throw new Error('READONLY');
        }
        if (key.endsWith(':expected')) order.push('expected');
        return set(key, value, ...args);
      },
    );

    await service.addSastIacJob(
      batch({ isLastRequest: true, historyPassOutcome: 'ok' }),
    );

    // A lost outcome reads as none at finalize: history findings are kept.
    expect(order).toEqual(['outcome', 'expected']);
    expect(sastIacQueue.add).toHaveBeenCalledTimes(1);
    expect(await service.getExpectedBatches('sast-iac', 's1', 'gitleaks')).toBe(
      1,
    );
  });

  it('is cleared with the batch tracking of the scanner', async () => {
    await service.setHistoryPassOutcome('s1', 'gitleaks', 'ok');

    await service.clearBatchTracking('sast-iac', 's1', 'gitleaks');

    expect(await service.getHistoryPassOutcome('s1', 'gitleaks')).toBeNull();
  });

  describe('a lost ingestion', () => {
    it('downgrades an ok outcome to failed, and answers the outcome it found', async () => {
      await service.setHistoryPassOutcome('s1', 'gitleaks', 'ok');

      expect(await service.markHistoryIngestionLost('s1', 'Gitleaks')).toBe(
        'ok',
      );

      expect(await service.getHistoryPassOutcome('s1', 'gitleaks')).toBe(
        'failed',
      );
    });

    it('also downgrades an ok outcome the last batch stores after the loss', async () => {
      expect(await service.markHistoryIngestionLost('s1', 'gitleaks')).toBe(
        null,
      );

      await service.addSastIacJob(
        batch({ isLastRequest: true, historyPassOutcome: 'ok' }),
      );

      expect(await service.getHistoryPassOutcome('s1', 'gitleaks')).toBe(
        'failed',
      );
    });

    it('leaves none alone: no history pass ran', async () => {
      await service.setHistoryPassOutcome('s1', 'gitleaks', 'none');

      expect(await service.markHistoryIngestionLost('s1', 'gitleaks')).toBe(
        'none',
      );

      expect(await service.getHistoryPassOutcome('s1', 'gitleaks')).toBe(
        'none',
      );
    });

    it('is cleared with the batch tracking of the scanner', async () => {
      await service.markHistoryIngestionLost('s1', 'gitleaks');
      await service.clearBatchTracking('sast-iac', 's1', 'gitleaks');
      await service.setHistoryPassOutcome('s1', 'gitleaks', 'ok');

      expect(await service.getHistoryPassOutcome('s1', 'gitleaks')).toBe('ok');
    });
  });

  it('the ignored paths are kept for finalize from the last batch', async () => {
    // A batch that is not the last keeps nothing.
    await service.addSastIacJob(batch({ ignoredPaths: ['skipped/a.py'] }));
    expect(await service.getIgnoredPaths('s1', 'gitleaks')).toEqual(new Set());

    await service.addSastIacJob(
      batch({
        isLastRequest: true,
        ignoredPaths: ['repo/tests/a.py', 'repo/vendor/b.js'],
      }),
    );

    expect(await service.getIgnoredPaths('s1', 'gitleaks')).toEqual(
      new Set(['repo/tests/a.py', 'repo/vendor/b.js']),
    );
    // Same scanner normalisation and 24 h TTL as the history outcome.
    expect(await service.getIgnoredPaths('s1', 'GITLEAKS')).toEqual(
      new Set(['repo/tests/a.py', 'repo/vendor/b.js']),
    );
    expect(redisMock.expire).toHaveBeenCalledWith(
      expect.stringContaining(':ignored-paths'),
      86400,
    );
    // Another scanner of the scan has its own set.
    expect(await service.getIgnoredPaths('s1', 'opengrep')).toEqual(new Set());

    await service.clearBatchTracking('sast-iac', 's1', 'gitleaks');
    expect(await service.getIgnoredPaths('s1', 'gitleaks')).toEqual(new Set());
  });

  it('is stored before the expected batch count, and a Redis refusal still enqueues the batch', async () => {
    const order: string[] = [];
    const sadd = redisMock.sadd.getMockImplementation();
    redisMock.sadd.mockImplementation(async (key: string, ...m: string[]) => {
      if (key.endsWith(':ignored-paths')) {
        order.push('ignored');
        throw new Error('READONLY');
      }
      return sadd(key, ...m);
    });
    const set = redisMock.set.getMockImplementation();
    redisMock.set.mockImplementation(
      async (key: string, value: string, ...args: unknown[]) => {
        if (key.endsWith(':expected')) order.push('expected');
        return set(key, value, ...args);
      },
    );

    await service.addSastIacJob(
      batch({ isLastRequest: true, ignoredPaths: ['a.py'] }),
    );

    expect(order).toEqual(['ignored', 'expected']);
    expect(sastIacQueue.add).toHaveBeenCalledTimes(1);
  });

  it('a scanner that sends no ignored paths stores nothing', async () => {
    await service.addSastIacJob(batch({ isLastRequest: true }));
    await service.addSastIacJob(
      batch({ scanId: 's2', isLastRequest: true, ignoredPaths: [] }),
    );

    expect(redisMock.sadd).not.toHaveBeenCalledWith(
      expect.stringContaining(':ignored-paths'),
      expect.anything(),
    );
    expect(await service.getIgnoredPaths('s1', 'gitleaks')).toEqual(new Set());
    expect(await service.getIgnoredPaths('s2', 'gitleaks')).toEqual(new Set());
  });
});

/**
 * The per-position lock `SastIacUtilsService.createNewVulnerability` holds
 * around its "duplicate lookup -> create", so two twin findings ingested
 * concurrently (3 workers per batch, batches consumed across pods) end up as
 * one detection instead of two. These are the Redis primitives; the policy
 * (what to do when Redis cannot answer) belongs to the caller and is pinned in
 * `sast-iac.detection-lock.spec.ts`.
 */
describe('ScanQueueService – detection creation lock', () => {
  let service: ScanQueueService;
  let redisMock: ReturnType<typeof createRedisMock>;

  const KEY = 'sast-iac:detection-lock:0123abcd';
  const setCallsOn = (key: string) =>
    redisMock.set.mock.calls.filter((c: unknown[]) => c[0] === key).length;

  beforeEach(async () => {
    redisMock = createRedisMock();
    service = await buildScanQueueService(redisMock);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('takes the key with SET NX PX, so a crashed holder frees it on its own', async () => {
    const token = await service.acquireDetectionCreationLock(KEY);

    expect(token).toEqual(expect.any(String));
    expect(redisMock.set).toHaveBeenCalledWith(
      KEY,
      token,
      'PX',
      ScanQueueService.DETECTION_CREATION_LOCK_TTL_MS,
      'NX',
    );
    expect(redisMock._store.get(KEY)).toBe(token);
  });

  it('hands out a fresh token on every acquisition', async () => {
    const first = await service.acquireDetectionCreationLock(KEY);
    await service.releaseDetectionCreationLock(KEY, first);

    const second = await service.acquireDetectionCreationLock(KEY);

    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  it('waits while the key is held and takes it once the holder releases it', async () => {
    jest.useFakeTimers();
    const holder = await service.acquireDetectionCreationLock(KEY);
    let waited: string | null | undefined;
    const waiter = service
      .acquireDetectionCreationLock(KEY)
      .then((t) => (waited = t));

    await jest.advanceTimersByTimeAsync(
      4 * ScanQueueService.DETECTION_CREATION_LOCK_POLL_MS,
    );
    expect(waited).toBeUndefined();
    expect(setCallsOn(KEY)).toBeGreaterThanOrEqual(4);

    await service.releaseDetectionCreationLock(KEY, holder);
    await jest.advanceTimersByTimeAsync(
      ScanQueueService.DETECTION_CREATION_LOCK_POLL_MS,
    );
    await waiter;

    expect(waited).toEqual(expect.any(String));
    expect(waited).not.toBe(holder);
    expect(redisMock._store.get(KEY)).toBe(waited);
  });

  it('gives up after the bounded wait and answers null, never taking the key', async () => {
    jest.useFakeTimers();
    const holder = await service.acquireDetectionCreationLock(KEY);
    let waited: string | null | undefined;
    const waiter = service
      .acquireDetectionCreationLock(KEY)
      .then((t) => (waited = t));

    await jest.advanceTimersByTimeAsync(
      ScanQueueService.DETECTION_CREATION_LOCK_MAX_WAIT_MS - 100,
    );
    expect(waited).toBeUndefined();

    await jest.advanceTimersByTimeAsync(200);
    await waiter;

    expect(waited).toBeNull();
    expect(redisMock._store.get(KEY)).toBe(holder);
  });

  it('releases the key only while it still holds the caller token (compare-and-delete)', async () => {
    const stale = await service.acquireDetectionCreationLock(KEY);
    // Its TTL ran out and another holder took the key over.
    redisMock._store.delete(KEY);
    const current = await service.acquireDetectionCreationLock(KEY);

    await expect(
      service.releaseDetectionCreationLock(KEY, stale),
    ).resolves.toBe(false);
    expect(redisMock._store.get(KEY)).toBe(current);

    await expect(
      service.releaseDetectionCreationLock(KEY, current),
    ).resolves.toBe(true);
    expect(redisMock._store.has(KEY)).toBe(false);
    expect(redisMock.eval).toHaveBeenLastCalledWith(
      ScanQueueService.DETECTION_CREATION_LOCK_RELEASE_SCRIPT,
      1,
      KEY,
      current,
    );
  });

  it('lets a Redis error reach the caller, which decides how to degrade', async () => {
    redisMock.set.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(service.acquireDetectionCreationLock(KEY)).rejects.toThrow(
      'ECONNRESET',
    );
  });
});
