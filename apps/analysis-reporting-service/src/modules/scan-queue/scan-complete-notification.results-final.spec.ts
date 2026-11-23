import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { status } from '@grpc/grpc-js';
import { NEVER, of, throwError } from 'rxjs';
import { ScanCompleteNotificationService } from './scan-complete-notification.service';
import { ScanQueueService } from './scan-queue.service';
import { QUEUE_NAMES } from './queue-names';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';

/**
 * A scan is `completed` only once its results are final: security-scanning
 * holds it `running` once every container is closed, until analysis-reporting
 * has finalized every scanner's results. analysis-reporting says so with
 * MarkScanResultsFinal, as soon as the end of the scan is ready, and answers
 * security-scanning's NotifyScanEnded with the same readiness rule, diff
 * scans included: a diff scan's findings are not stored either until its
 * scanners are finalized.
 */

/** In-memory Redis: the sets and keys the end of a scan reads. */
function createRedisMock() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    sadd: jest.fn(async (key: string, ...members: string[]) => {
      const set = sets.get(key) ?? new Set<string>();
      sets.set(key, set);
      const before = set.size;
      members.forEach((member) => set.add(member));
      return set.size - before;
    }),
    smembers: jest.fn(async (key: string) => Array.from(sets.get(key) ?? [])),
    scard: jest.fn(async (key: string) => sets.get(key)?.size ?? 0),
    expire: jest.fn(async () => 1),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (...keys: string[]) => {
      keys.forEach((key) => {
        store.delete(key);
        sets.delete(key);
      });
      return keys.length;
    }),
    _store: store,
  };
}

const lockKey = (scanId: string) => `scan-complete-notification:${scanId}`;

describe('ScanCompleteNotificationService: results final', () => {
  let service: ScanCompleteNotificationService;
  let redis: ReturnType<typeof createRedisMock>;
  let awaiting: Set<string>;
  let scanServiceClient: {
    getScan: jest.Mock;
    markScanResultsFinal: jest.Mock;
    markHistoryIngestionFailed: jest.Mock;
  };
  let slackClient: { sendNotification: jest.Mock };
  let issueIntegrationService: { createIssuesForScan: jest.Mock };
  let cyberiskEnqueuer: { enqueue: jest.Mock };
  let scanQueueService: {
    getRedisClient: jest.Mock;
    getRegisteredScanQueueTypes: jest.Mock;
    getScannersAwaitingFinalization: jest.Mock;
    clearBatchTracking: jest.Mock;
    markHistoryIngestionLost: jest.Mock;
  };
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    redis = createRedisMock();
    // The scanners that sent their last batch and are not finalized yet
    // (sast-iac only), as the batch tracking reports them.
    awaiting = new Set<string>();
    scanServiceClient = {
      getScan: jest.fn(),
      markScanResultsFinal: jest
        .fn()
        .mockReturnValue(of({ success: true, outcome: 'finalized' })),
      markHistoryIngestionFailed: jest
        .fn()
        .mockReturnValue(of({ success: true })),
    };
    slackClient = {
      sendNotification: jest.fn().mockReturnValue(of({ success: true })),
    };
    issueIntegrationService = {
      createIssuesForScan: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    cyberiskEnqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) };
    scanQueueService = {
      getRedisClient: jest.fn().mockResolvedValue(redis),
      getRegisteredScanQueueTypes: jest.fn().mockResolvedValue([]),
      getScannersAwaitingFinalization: jest.fn(async (queueType: string) =>
        queueType === 'sast-iac' ? [...awaiting] : [],
      ),
      clearBatchTracking: jest.fn(
        async (_type: string, _scanId: string, scanner: string) => {
          awaiting.delete(scanner);
        },
      ),
      // The outcome the scanner's last batch stored: none by default.
      markHistoryIngestionLost: jest.fn().mockResolvedValue(null),
    };

    const grpcClient = (services: Record<string, unknown>) => ({
      getService: jest.fn((name: string) => services[name] ?? {}),
    });
    const repository = { count: jest.fn().mockResolvedValue(0) };
    const module = await Test.createTestingModule({
      providers: [
        ScanCompleteNotificationService,
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: grpcClient({
            ProjectService: {
              get: jest.fn().mockReturnValue(
                of({
                  name: 'Project',
                  scanCompleteSlackEnabled: true,
                  scanCompleteEmailEnabled: false,
                }),
              ),
            },
            MailReportService: {},
          }),
        },
        {
          provide: 'EXTERNAL_INTEGRATIONS_SERVICE',
          useValue: grpcClient({ SlackService: slackClient }),
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: grpcClient({ ScanService: scanServiceClient }),
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: repository,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: repository,
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: repository,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: repository,
        },
        { provide: ScanQueueService, useValue: scanQueueService },
        { provide: IssueIntegrationService, useValue: issueIntegrationService },
        {
          provide: getQueueToken(QUEUE_NAMES.SCAN_END_EVALUATION),
          useValue: { add: jest.fn() },
        },
        { provide: CyberiskRecomputeEnqueuer, useValue: cyberiskEnqueuer },
      ],
    }).compile();
    service = module.get(ScanCompleteNotificationService);
    service.onModuleInit();
    warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** getScan answers this scan: Opengrep and KICS (sast-iac), maybe SCA. */
  function scanIs({
    isDiffScan = false,
    kics = 'completed',
    sca = false,
  }: { isDiffScan?: boolean; kics?: string; sca?: boolean } = {}) {
    scanServiceClient.getScan.mockReturnValue(
      of({
        containers: [
          { image: 'scanlink-sast-opengrep', status: 'completed' },
          { image: 'scanlink-iac-kics', status: kics },
          ...(sca ? [{ image: 'scanlink-sca', status: 'completed' }] : []),
        ],
        scanType: 'full',
        branch: 'main',
        isDiffScan,
      }),
    );
  }

  /** A scanner's finalization as recorded in Redis, without dispatching. */
  async function finalizedBefore(scanId: string, ...scanners: string[]) {
    await redis.sadd(`scan-finalized-scanners:${scanId}:sast-iac`, ...scanners);
    await redis.sadd(`scan-finalized-types:${scanId}`, 'sast-iac');
  }

  /** The order of the call that took the scan-complete lock of `scanId`. */
  function lockOrder(scanId: string): number {
    const index = redis.set.mock.calls.findIndex(
      ([key]) => key === lockKey(scanId),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    return redis.set.mock.invocationCallOrder[index];
  }

  /** The WARN line that names `scanId` and says `text`, if any. */
  function warning(scanId: string, text: string): string | undefined {
    return warnSpy.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes(scanId) && message.includes(text));
  }

  describe('onScanEnded on a diff scan', () => {
    it('answers waiting while a scanner is not finalized', async () => {
      scanIs({ isDiffScan: true });
      await finalizedBefore('scan-diff', 'opengrep');

      expect(await service.onScanEnded('scan-diff', 'proj-1')).toBe('waiting');
    });

    it('answers waiting while a scanner that sent its last batch is not finalized, its container failed', async () => {
      scanIs({ isDiffScan: true, kics: 'failed' });
      await finalizedBefore('scan-diff', 'opengrep');
      awaiting.add('kics');

      expect(await service.onScanEnded('scan-diff', 'proj-1')).toBe('waiting');
    });

    it('answers diff_scan once every scanner is finalized, and dispatches nothing', async () => {
      scanIs({ isDiffScan: true });
      await finalizedBefore('scan-diff', 'opengrep', 'kics');

      expect(await service.onScanEnded('scan-diff', 'proj-1')).toBe(
        'diff_scan',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();
      expect(cyberiskEnqueuer.enqueue).not.toHaveBeenCalled();
      expect(redis._store.has(lockKey('scan-diff'))).toBe(false);
    });

    it('answers nothing_finalized when every scanner failed before finalizing any result', async () => {
      scanServiceClient.getScan.mockReturnValue(
        of({
          containers: [{ image: 'scanlink-sast-opengrep', status: 'failed' }],
          isDiffScan: true,
        }),
      );

      expect(await service.onScanEnded('scan-diff', 'proj-1')).toBe(
        'nothing_finalized',
      );
    });

    it('never calls MarkScanResultsFinal itself: security-scanning reads its answer', async () => {
      scanIs({ isDiffScan: true });
      await finalizedBefore('scan-diff', 'opengrep', 'kics');

      await service.onScanEnded('scan-diff', 'proj-1');

      expect(scanServiceClient.markScanResultsFinal).not.toHaveBeenCalled();
    });
  });

  describe('onScannerFinalized', () => {
    it.each([
      ['a normal scan', false],
      ['a diff scan', true],
    ])(
      'calls MarkScanResultsFinal once readiness is ready, before dispatching the end, for %s',
      async (_label, isDiffScan) => {
        scanIs({ isDiffScan });
        await finalizedBefore('scan-ready', 'opengrep');

        await service.onScannerFinalized(
          'scan-ready',
          'proj-1',
          'sast-iac',
          'kics',
        );

        expect(scanServiceClient.markScanResultsFinal).toHaveBeenCalledTimes(1);
        expect(scanServiceClient.markScanResultsFinal).toHaveBeenCalledWith({
          scanId: 'scan-ready',
        });
        const callOrder =
          scanServiceClient.markScanResultsFinal.mock.invocationCallOrder[0];
        expect(callOrder).toBeLessThan(lockOrder('scan-ready'));
        if (isDiffScan) {
          expect(slackClient.sendNotification).not.toHaveBeenCalled();
        } else {
          expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
          expect(callOrder).toBeLessThan(
            slackClient.sendNotification.mock.invocationCallOrder[0],
          );
        }
      },
    );

    it('does not call it while a scanner is not finalized, then calls it once with the last', async () => {
      scanIs({ sca: true });

      await service.onScannerFinalized(
        'scan-wait',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      await service.onScannerFinalized(
        'scan-wait',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(scanServiceClient.markScanResultsFinal).not.toHaveBeenCalled();

      await service.onScannerFinalized(
        'scan-wait',
        'proj-1',
        'sast-iac',
        'kics',
      );
      expect(scanServiceClient.markScanResultsFinal).toHaveBeenCalledTimes(1);
    });

    it('does not call it while a scanner that sent its last batch is not finalized', async () => {
      scanIs({ isDiffScan: true, kics: 'failed' });
      awaiting.add('kics');

      await service.onScannerFinalized(
        'scan-awaiting',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      expect(scanServiceClient.markScanResultsFinal).not.toHaveBeenCalled();
    });

    it("logs security-scanning's outcome with the scan id", async () => {
      scanIs();
      await finalizedBefore('scan-logged', 'opengrep');
      scanServiceClient.markScanResultsFinal.mockReturnValue(
        of({ success: true, outcome: 'containers_open' }),
      );
      const log = jest.spyOn((service as any).logger, 'log');

      await service.onScannerFinalized(
        'scan-logged',
        'proj-1',
        'sast-iac',
        'kics',
      );

      const line = log.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes('containers_open'));
      expect(line).toContain('scan-logged');
    });
  });

  describe('giveUpScanner', () => {
    const giveUpKics = (scanId: string) =>
      service.giveUpScanner({
        scanId,
        projectId: 'proj-1',
        scannerType: 'sast-iac',
        scannerName: 'kics',
      });

    it.each([
      [
        'dispatched',
        async () => {
          scanIs({ kics: 'failed' });
          await finalizedBefore('scan-given-up', 'opengrep');
        },
      ],
      [
        'diff_scan',
        async () => {
          scanIs({ isDiffScan: true, kics: 'failed' });
          await finalizedBefore('scan-given-up', 'opengrep');
        },
      ],
      [
        'nothing_finalized',
        async () => {
          scanServiceClient.getScan.mockReturnValue(
            of({
              containers: [{ image: 'scanlink-iac-kics', status: 'failed' }],
            }),
          );
        },
      ],
      [
        'already_dispatched',
        async () => {
          scanIs({ kics: 'failed' });
          await finalizedBefore('scan-given-up', 'opengrep');
          await redis.set(lockKey('scan-given-up'), '1');
        },
      ],
    ])(
      'calls MarkScanResultsFinal when the outcome is %s',
      async (outcome, arrange) => {
        await arrange();
        awaiting.add('kics');

        expect(await giveUpKics('scan-given-up')).toBe(outcome);
        expect(scanServiceClient.markScanResultsFinal).toHaveBeenCalledTimes(1);
        expect(scanServiceClient.markScanResultsFinal).toHaveBeenCalledWith({
          scanId: 'scan-given-up',
        });
      },
    );

    it('does not call it when the outcome is waiting', async () => {
      scanIs({ sca: true });
      await finalizedBefore('scan-still-waiting', 'opengrep');

      expect(await giveUpKics('scan-still-waiting')).toBe('waiting');
      expect(scanServiceClient.markScanResultsFinal).not.toHaveBeenCalled();
    });
  });

  describe('a failing MarkScanResultsFinal never prevents the dispatch', () => {
    const failures: Array<[string, () => void, string]> = [
      [
        'rejects (UNAVAILABLE)',
        () =>
          scanServiceClient.markScanResultsFinal.mockReturnValue(
            throwError(() =>
              Object.assign(new Error('14 UNAVAILABLE: no connection'), {
                code: status.UNAVAILABLE,
                details: 'no connection',
              }),
            ),
          ),
        'UNAVAILABLE',
      ],
      [
        'is not implemented (an older security-scanning)',
        () =>
          scanServiceClient.markScanResultsFinal.mockReturnValue(
            throwError(() =>
              Object.assign(new Error('12 UNIMPLEMENTED: unknown method'), {
                code: status.UNIMPLEMENTED,
                details: 'unknown method',
              }),
            ),
          ),
        'does not implement MarkScanResultsFinal',
      ],
      [
        'throws before answering',
        () =>
          scanServiceClient.markScanResultsFinal.mockImplementation(() => {
            throw new Error('client closed');
          }),
        'client closed',
      ],
    ];

    it.each(failures)(
      'dispatches when the call %s, and warns with the scan id',
      async (_label, arrange, warned) => {
        arrange();
        scanIs();
        await finalizedBefore('scan-callback-failed', 'opengrep');

        await service.onScannerFinalized(
          'scan-callback-failed',
          'proj-1',
          'sast-iac',
          'kics',
        );

        expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
        expect(
          issueIntegrationService.createIssuesForScan,
        ).toHaveBeenCalledTimes(1);
        expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledWith(
          'proj-1',
          'scan_complete',
        );
        expect(warning('scan-callback-failed', warned)).toBeDefined();
      },
    );

    it.each(failures)(
      'giveUpScanner still answers its outcome when the call %s: its job does not retry a done dispatch',
      async (_label, arrange) => {
        arrange();
        scanIs({ kics: 'failed' });
        await finalizedBefore('scan-callback-failed', 'opengrep');
        awaiting.add('kics');

        await expect(
          service.giveUpScanner({
            scanId: 'scan-callback-failed',
            projectId: 'proj-1',
            scannerType: 'sast-iac',
            scannerName: 'kics',
          }),
        ).resolves.toBe('dispatched');
        expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      },
    );

    it('holds the dispatch 10 s at most when security-scanning does not answer', async () => {
      jest.useFakeTimers();
      scanServiceClient.markScanResultsFinal.mockReturnValue(NEVER);
      scanIs();
      await finalizedBefore('scan-callback-hung', 'opengrep');

      let finished = false;
      const finalization = service
        .onScannerFinalized('scan-callback-hung', 'proj-1', 'sast-iac', 'kics')
        .then(() => {
          finished = true;
        });

      await jest.advanceTimersByTimeAsync(9_999);
      expect(slackClient.sendNotification).not.toHaveBeenCalled();
      expect(finished).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      await finalization;
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(warning('scan-callback-hung', '10000 ms')).toBeDefined();
    });
  });
  describe('a lost history ingestion', () => {
    const giveUp = (scanId: string, scannerName: string) =>
      service.giveUpScanner({
        scanId,
        projectId: 'proj-1',
        scannerType: 'sast-iac',
        scannerName,
      });
    const secretBatch = (scanId: string, secretPass?: string) =>
      ({
        scanId,
        projectId: 'proj-1',
        scannerName: 'gitleaks',
        isLastRequest: false,
        vulnerabilities: [{ secretPass }],
      }) as never;
    const unavailable = () =>
      throwError(() =>
        Object.assign(new Error('14 UNAVAILABLE: connection refused'), {
          code: status.UNAVAILABLE,
        }),
      );

    it('a terminal batch failure of gitleaks gives a failed history pass, recorded before the results are final', async () => {
      scanIs();
      await finalizedBefore('scan-lost', 'opengrep');

      await service.recordHistoryIngestionLoss(
        'scan-lost',
        'gitleaks',
        secretBatch('scan-lost', 'head'),
      );
      await service.onScannerFinalized(
        'scan-lost',
        'proj-1',
        'sast-iac',
        'kics',
      );

      expect(scanQueueService.markHistoryIngestionLost).toHaveBeenCalledWith(
        'scan-lost',
        'gitleaks',
      );
      expect(scanServiceClient.markHistoryIngestionFailed).toHaveBeenCalledWith(
        { scanId: 'scan-lost', scannerName: 'gitleaks' },
      );
      expect(scanServiceClient.markScanResultsFinal).toHaveBeenCalledTimes(1);
      expect(
        scanServiceClient.markHistoryIngestionFailed.mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        scanServiceClient.markScanResultsFinal.mock.invocationCallOrder[0],
      );
    });

    it('a given-up gitleaks scanner gives a failed history pass', async () => {
      scanQueueService.markHistoryIngestionLost.mockResolvedValue('ok');
      scanIs();
      await finalizedBefore('scan-given-up', 'opengrep', 'kics');

      expect(await giveUp('scan-given-up', 'gitleaks')).toBe('dispatched');

      // Read before the give-up clears the scanner's tracking.
      expect(
        scanQueueService.markHistoryIngestionLost.mock.invocationCallOrder[0],
      ).toBeLessThan(
        scanQueueService.clearBatchTracking.mock.invocationCallOrder[0],
      );
      expect(scanServiceClient.markHistoryIngestionFailed).toHaveBeenCalledWith(
        {
          scanId: 'scan-given-up',
          scannerName: 'gitleaks',
        },
      );
      expect(
        scanServiceClient.markHistoryIngestionFailed.mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        scanServiceClient.markScanResultsFinal.mock.invocationCallOrder[0],
      );
    });

    it('results are not marked final when the history failure cannot be recorded', async () => {
      scanQueueService.markHistoryIngestionLost.mockResolvedValue('ok');
      scanServiceClient.markHistoryIngestionFailed.mockReturnValue(
        unavailable(),
      );
      scanIs();
      await finalizedBefore('scan-unrecorded', 'opengrep', 'kics');

      // The end is dispatched (notifications do not wait), but neither
      // MarkScanResultsFinal nor NotifyScanEnded's answer lets
      // security-scanning take the results as final: the scan ends at the
      // results ceiling, which never moves the cursor.
      expect(await giveUp('scan-unrecorded', 'gitleaks')).toBe('waiting');
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(scanServiceClient.markScanResultsFinal).not.toHaveBeenCalled();
      expect(await service.onScanEnded('scan-unrecorded', 'proj-1')).toBe(
        'waiting',
      );
      expect(
        warning(
          'scan-unrecorded',
          'history pass failure could not be recorded',
        ),
      ).toBeDefined();

      // Once security-scanning records it, the scan's results are final.
      scanServiceClient.markHistoryIngestionFailed.mockReturnValue(
        of({ success: true }),
      );
      expect(await service.onScanEnded('scan-unrecorded', 'proj-1')).toBe(
        'already_dispatched',
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('a scanner that ran no history pass records nothing on security-scanning', async () => {
      scanIs();
      await finalizedBefore('scan-no-history', 'opengrep');

      await service.recordHistoryIngestionLoss(
        'scan-no-history',
        'kics',
        secretBatch('scan-no-history'),
      );
      scanQueueService.markHistoryIngestionLost.mockResolvedValue('none');
      await giveUp('scan-no-history', 'kics');

      expect(
        scanServiceClient.markHistoryIngestionFailed,
      ).not.toHaveBeenCalled();
      expect(scanServiceClient.markScanResultsFinal).toHaveBeenCalledTimes(1);
    });

    it('an older security-scanning without the RPC does not hold the results', async () => {
      scanServiceClient.markHistoryIngestionFailed.mockReturnValue(
        throwError(() =>
          Object.assign(new Error('12 UNIMPLEMENTED'), {
            code: status.UNIMPLEMENTED,
          }),
        ),
      );
      scanIs();
      await finalizedBefore('scan-old-ss', 'opengrep');

      await service.recordHistoryIngestionLoss(
        'scan-old-ss',
        'gitleaks',
        secretBatch('scan-old-ss', 'history'),
      );
      await service.onScannerFinalized(
        'scan-old-ss',
        'proj-1',
        'sast-iac',
        'kics',
      );

      expect(scanServiceClient.markScanResultsFinal).toHaveBeenCalledTimes(1);
    });
  });
});
