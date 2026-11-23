import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { of, throwError } from 'rxjs';
import { ScanCompleteNotificationService } from './scan-complete-notification.service';
import { ScanQueueService } from './scan-queue.service';
import { QUEUE_NAMES } from './queue-names';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { SCAN_COMPLETED_LISTENERS } from 'src/edition/ports/scan-completed-listeners.port';
import { sanitizeToolName } from '../results-import/sarif/sarif-mapper';

/**
 * In-memory Redis mock that supports SET operations (sadd, smembers, scard),
 * key-value operations (set, get, del, incr), and expiry.
 */
function createRedisMock() {
  const store = new Map<string, any>();
  const sets = new Map<string, Set<string>>();

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
    smembers: jest.fn(async (key: string) => {
      return Array.from(sets.get(key) || []);
    }),
    scard: jest.fn(async (key: string) => {
      return sets.get(key)?.size || 0;
    }),
    expire: jest.fn(async () => 1),
    set: jest.fn(async (key: string, value: string, ...args: any[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) || null),
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
      const val = parseInt(store.get(key) || '0', 10) + 1;
      store.set(key, String(val));
      return val;
    }),
    _store: store,
    _sets: sets,
    _reset: () => {
      store.clear();
      sets.clear();
    },
  };
}

describe('ScanCompleteNotificationService', () => {
  let service: ScanCompleteNotificationService;
  let redisMock: ReturnType<typeof createRedisMock>;
  let scanQueueService: {
    getRedisClient: jest.Mock;
    getRegisteredScanQueueTypes: jest.Mock;
    getScannersAwaitingFinalization: jest.Mock;
    clearBatchTracking: jest.Mock;
    markHistoryIngestionLost: jest.Mock;
  };
  let scanServiceClient: { getScan: jest.Mock };
  let projectClient: { get: jest.Mock };
  let slackClient: { sendNotification: jest.Mock };
  let scanCompletedListener: { onScanCompleted: jest.Mock };
  let issueIntegrationService: { createIssuesForScan: jest.Mock };
  let cyberiskEnqueuer: { enqueue: jest.Mock };
  let mockRepoCount: jest.Mock;
  let scanEndQueue: { add: jest.Mock };

  beforeEach(async () => {
    redisMock = createRedisMock();
    mockRepoCount = jest.fn().mockResolvedValue(0);
    scanEndQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    scanServiceClient = {
      getScan: jest.fn(),
    };
    projectClient = {
      get: jest.fn().mockReturnValue(
        of({
          name: 'TestProject',
          scanCompleteSlackEnabled: true,
          scanCompleteEmailEnabled: false,
        }),
      ),
    };
    slackClient = {
      sendNotification: jest.fn().mockReturnValue(of({ success: true })),
    };
    scanCompletedListener = {
      onScanCompleted: jest.fn().mockResolvedValue(undefined),
    };
    issueIntegrationService = {
      createIssuesForScan: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    cyberiskEnqueuer = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    scanQueueService = {
      getRedisClient: jest.fn().mockResolvedValue(redisMock),
      getRegisteredScanQueueTypes: jest.fn().mockResolvedValue([]),
      getScannersAwaitingFinalization: jest.fn().mockResolvedValue([]),
      clearBatchTracking: jest.fn().mockResolvedValue(undefined),
      // No history pass by default: a given-up scanner tells nothing more.
      markHistoryIngestionLost: jest.fn().mockResolvedValue(null),
    };

    service = await buildService();
  });

  /**
   * Builds the service through Nest with the mocks above. What the service
   * reads from the environment at construction (the deferral TTL) is read
   * again on every build.
   */
  async function buildService(
    listeners: Array<{ onScanCompleted: jest.Mock }> | undefined = [
      scanCompletedListener,
    ],
  ): Promise<ScanCompleteNotificationService> {
    const mockGrpcClient = (clients: Record<string, any>) => ({
      getService: jest.fn((name: string) => clients[name] || {}),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanCompleteNotificationService,
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: mockGrpcClient({
            ProjectService: projectClient,
            MailReportService: {},
          }),
        },
        ...(listeners
          ? [{ provide: SCAN_COMPLETED_LISTENERS, useValue: listeners }]
          : []),
        {
          provide: 'EXTERNAL_INTEGRATIONS_SERVICE',
          useValue: mockGrpcClient({ SlackService: slackClient }),
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: mockGrpcClient({ ScanService: scanServiceClient }),
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: { count: mockRepoCount },
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: { count: mockRepoCount },
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: { count: mockRepoCount },
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: { count: mockRepoCount },
        },
        { provide: ScanQueueService, useValue: scanQueueService },
        { provide: IssueIntegrationService, useValue: issueIntegrationService },
        {
          provide: getQueueToken(QUEUE_NAMES.SCAN_END_EVALUATION),
          useValue: scanEndQueue,
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: cyberiskEnqueuer,
        },
      ],
    }).compile();

    const built = module.get(ScanCompleteNotificationService);
    built.onModuleInit();
    return built;
  }

  /** Rebuilds the service with another listener list (undefined: unbound). */
  async function rebuildWithListeners(
    listeners: Array<{ onScanCompleted: jest.Mock }> | undefined,
  ): Promise<void> {
    service = await buildService(listeners);
  }

  /** Set up scan containers returned by getScan (used for both expected counts and dispatch) */
  function setupScanContainers(
    containers: { image: string; status?: string }[],
  ) {
    scanServiceClient.getScan.mockReturnValue(
      of({
        containers,
        scanType: 'full',
        branch: 'main',
      }),
    );
  }

  /**
   * A scan whose only scanner (SAST) is done, with the AI agent container,
   * named `agent-service` as security-scanning creates it, in `agentStatus`.
   */
  function scanWithAgent(agentStatus: string) {
    return {
      containers: [
        { image: 'scanlink-sast-opengrep', status: 'completed' },
        { image: 'agent-service', status: agentStatus },
      ],
      scanType: 'full',
      branch: 'main',
    };
  }

  describe('single scanner per category', () => {
    it('should dispatch notification after the single scanner finalizes', async () => {
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-1',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('Community cybedefend-scanners images (Kubernetes scans)', () => {
    const mapImage = (image: string): string | null =>
      service['mapImageToCategory'](image);

    it.each([
      ['cybedefend-scanners/opengrep', 'sast-iac'],
      ['cybedefend-scanners/zizmor', 'sast-iac'],
      ['cybedefend-scanners/gitleaks', 'sast-iac'],
      ['cybedefend-scanners/trivy-config', 'sast-iac'],
      ['cybedefend-scanners/trivy-fs', 'sca'],
    ])('maps %s to %s, with or without a registry', (name, category) => {
      expect(mapImage(`${name}:1.0.0`)).toBe(category);
      expect(mapImage(`ghcr.io/cybedefend/${name}:1.0.0`)).toBe(category);
      expect(mapImage(`registry.local:5000/scanners/${name}:v2`)).toBe(
        category,
      );
      expect(mapImage(name)).toBe(category);
    });

    it.each([
      ['cybedefend-scanners/trivy-image:1.0.0', null],
      ['cybedefend-scanners:1.0.0', null],
      ['cybedefend-scanners/unknown:1.0.0', null],
      ['opengrep:1.0.0', null],
      ['ghcr.io/someone/opengrep:1.0.0', null],
      ['ghcr.io/x/other-scanners/trivy-fs:1.0.0', null],
    ])('leaves %s without a category', (image, category) => {
      expect(mapImage(image)).toBe(category);
    });

    it.each([
      ['scanlink-sast-opengrep:0.3.0', 'sast-iac'],
      ['scanlink-iac-kics', 'sast-iac'],
      ['scanlink-secret-gitleaks', 'sast-iac'],
      ['gcr.io/x/scanlink-sca:latest', 'sca'],
      ['registry.local:5000/x/scanlink-sca:1', 'sca'],
      ['scanlink-sast-opengrep@sha256:abc', 'sast-iac'],
      ['scanlink-container:1', 'container'],
      ['scanlink-agent', null],
      ['agent-service', null],
    ])('still maps the cloud image %s to %s', (image, category) => {
      expect(mapImage(image)).toBe(category);
    });

    it('a scan with opengrep, zizmor, gitleaks, trivy-config and trivy-fs containers notifies once, after the fifth onScannerFinalized', async () => {
      setupScanContainers([
        { image: 'cybedefend-scanners/opengrep:1.0.0', status: 'completed' },
        { image: 'cybedefend-scanners/zizmor:1.0.0', status: 'completed' },
        { image: 'cybedefend-scanners/gitleaks:1.0.0', status: 'completed' },
        {
          image: 'cybedefend-scanners/trivy-config:1.0.0',
          status: 'completed',
        },
        { image: 'cybedefend-scanners/trivy-fs:1.0.0', status: 'completed' },
      ]);

      // The tool names the import derives from each image's SARIF
      // runs[].tool.driver.name (scan-docker fixtures and tools: Opengrep
      // writes "Opengrep OSS", zizmor "zizmor", gitleaks "gitleaks", Trivy
      // "Trivy" for both `trivy config` and `trivy fs`).
      const finalizations: Array<[string, string]> = [
        ['sast-iac', sanitizeToolName('Opengrep OSS')],
        ['sast-iac', sanitizeToolName('zizmor')],
        ['sast-iac', sanitizeToolName('gitleaks')],
        ['sast-iac', sanitizeToolName('Trivy')],
        ['sca', sanitizeToolName('Trivy')],
      ];
      // The four sast-iac tools are distinct, or the count would never reach 4.
      expect(
        new Set(
          finalizations.filter(([c]) => c === 'sast-iac').map(([, t]) => t),
        ).size,
      ).toBe(4);

      for (const [index, [category, tool]] of finalizations.entries()) {
        await service.onScannerFinalized(
          'scan-community-5',
          'proj-1',
          category,
          tool,
        );
        expect(slackClient.sendNotification).toHaveBeenCalledTimes(
          index === finalizations.length - 1 ? 1 : 0,
        );
        expect(
          issueIntegrationService.createIssuesForScan,
        ).toHaveBeenCalledTimes(index === finalizations.length - 1 ? 1 : 0);
      }
      expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledTimes(1);
      expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledWith(
        'proj-1',
        'scan_complete',
      );

      // A finalization replayed after the end sends nothing more.
      await service.onScannerFinalized(
        'scan-community-5',
        'proj-1',
        'sca',
        sanitizeToolName('Trivy'),
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('multiple scanners in same category', () => {
    it('should NOT dispatch notification after only the first scanner finalizes', async () => {
      setupScanContainers([
        { image: 'scanlink-sast-opengrep', status: 'completed' },
        { image: 'scanlink-sast-bearer', status: 'completed' },
      ]);

      await service.onScannerFinalized(
        'scan-2',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      expect(slackClient.sendNotification).not.toHaveBeenCalled();
    });

    it('should dispatch notification after ALL scanners in the category finalize', async () => {
      setupScanContainers([
        { image: 'scanlink-sast-opengrep', status: 'completed' },
        { image: 'scanlink-sast-bearer', status: 'completed' },
      ]);

      await service.onScannerFinalized(
        'scan-3',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();

      await service.onScannerFinalized(
        'scan-3',
        'proj-1',
        'sast-iac',
        'bearer',
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledWith(
        'proj-1',
        'scan_complete',
      );
    });
  });

  describe('mixed categories with multiple scanners', () => {
    it('should wait for all scanners across all categories', async () => {
      setupScanContainers([
        { image: 'scanlink-sast-opengrep', status: 'completed' },
        { image: 'scanlink-sast-bearer', status: 'completed' },
        { image: 'scanlink-sca', status: 'completed' },
      ]);

      await service.onScannerFinalized(
        'scan-4',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();

      await service.onScannerFinalized(
        'scan-4',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();

      await service.onScannerFinalized(
        'scan-4',
        'proj-1',
        'sast-iac',
        'bearer',
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('duplicate scanner name deduplication', () => {
    it('should not double-count when the same scanner calls onScannerFinalized twice', async () => {
      setupScanContainers([
        { image: 'scanlink-sast-opengrep', status: 'completed' },
        { image: 'scanlink-sast-bearer', status: 'completed' },
      ]);

      // opengrep calls twice (e.g., retry)
      await service.onScannerFinalized(
        'scan-5',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      await service.onScannerFinalized(
        'scan-5',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      expect(slackClient.sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('lock prevents duplicate notifications', () => {
    it('should send notification only once even if two calls race', async () => {
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-6',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);

      await service.onScannerFinalized(
        'scan-6',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('fallback to registered types (category-level)', () => {
    it('should fall back to category-level tracking when container lookup fails', async () => {
      // First call (getExpectedScannerCounts) fails, second call (dispatchNotifications) succeeds
      scanServiceClient.getScan
        .mockReturnValueOnce(throwError(() => new Error('gRPC unavailable')))
        .mockReturnValue(
          of({ scanType: 'full', branch: 'main', containers: [] }),
        );
      scanQueueService.getRegisteredScanQueueTypes.mockResolvedValue(['sca']);

      await service.onScannerFinalized(
        'scan-7',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('skips failed containers', () => {
    it('should not wait for scanners whose container failed', async () => {
      setupScanContainers([
        { image: 'scanlink-sast-opengrep', status: 'completed' },
        { image: 'scanlink-sast-bearer', status: 'failed' },
        { image: 'scanlink-sca', status: 'completed' },
      ]);

      // Only opengrep (sast-iac) and scanlink-sca expected (bearer failed → sast-iac expects 1)
      await service.onScannerFinalized(
        'scan-8',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();

      await service.onScannerFinalized(
        'scan-8',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('agent-aware notification deferral', () => {
    it('should defer notification when agent container is still running', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'running' },
      ]);

      await service.onScannerFinalized(
        'scan-agent-1',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(slackClient.sendNotification).not.toHaveBeenCalled();

      const deferred = await redisMock.get(
        'scan-notification-deferred:scan-agent-1',
      );
      expect(deferred).toBeTruthy();
      expect(JSON.parse(deferred).projectId).toBe('proj-1');
    });

    it('should defer notification when agent container is in parsing_completed state', async () => {
      setupScanContainers([
        { image: 'scanlink-sast-opengrep', status: 'completed' },
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'parsing_completed' },
      ]);

      await service.onScannerFinalized(
        'scan-agent-2',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      await service.onScannerFinalized(
        'scan-agent-2',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      expect(slackClient.sendNotification).not.toHaveBeenCalled();
    });

    it('should send notification immediately when no agent container exists', async () => {
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-no-agent',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('should send notification immediately when agent container is already completed', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'completed' },
      ]);

      await service.onScannerFinalized(
        'scan-agent-done',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('should send notification immediately when agent container has failed', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'failed' },
      ]);

      await service.onScannerFinalized(
        'scan-agent-failed',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });
  });

  // Once the scanners are done, security-scanning closes the agent container
  // within AGENT_INGESTION_MAX_MS + AI_QUEUE_MAX_WAIT_MS + AI_ANALYSIS_MAX_MS
  // (5 h by default). A deferral key that expires first loses the
  // notification, the issue creation and the cyber-risk recompute.
  describe('deferral lifetime (SCAN_NOTIFICATION_DEFER_TTL_SEC)', () => {
    const TTL_ENV = 'SCAN_NOTIFICATION_DEFER_TTL_SEC';
    const ttlEnvBefore = process.env[TTL_ENV];

    /** Rebuilds the service with the TTL variable set to `value`, or unset. */
    async function buildServiceWithTtlEnv(value: string | undefined) {
      if (value === undefined) delete process.env[TTL_ENV];
      else process.env[TTL_ENV] = value;
      service = await buildService();
    }

    async function deferTheNotification() {
      scanServiceClient.getScan.mockReturnValue(of(scanWithAgent('running')));
      await service.onScannerFinalized(
        'scan-ttl',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
    }

    afterEach(() => {
      if (ttlEnvBefore === undefined) delete process.env[TTL_ENV];
      else process.env[TTL_ENV] = ttlEnvBefore;
    });

    it('keeps the deferral 6 h by default, beyond the 5 h the AI budgets allow', async () => {
      await buildServiceWithTtlEnv(undefined);

      await deferTheNotification();

      expect(redisMock.set).toHaveBeenCalledWith(
        'scan-notification-deferred:scan-ttl',
        expect.any(String),
        'EX',
        21600,
      );
    });

    it('takes the lifetime from SCAN_NOTIFICATION_DEFER_TTL_SEC', async () => {
      await buildServiceWithTtlEnv('100');

      await deferTheNotification();

      expect(redisMock.set).toHaveBeenCalledWith(
        'scan-notification-deferred:scan-ttl',
        expect.any(String),
        'EX',
        100,
      );
    });

    // parseInt reads '6h' as 6 s and '2.5' as 2 s; Number() hands 2.5 and -1
    // to Redis, which refuses them. Either way the notification is lost.
    it.each(['6h', '2.5', '-1', '0'])(
      'keeps the 6 h default when the variable is %p',
      async (value) => {
        await buildServiceWithTtlEnv(value);

        await deferTheNotification();

        expect(redisMock.set).toHaveBeenCalledWith(
          'scan-notification-deferred:scan-ttl',
          expect.any(String),
          'EX',
          21600,
        );
      },
    );
  });

  // The agent can end between isAgentPendingForScan and the write of the
  // deferral. security-scanning's notifyScanComplete then finds no key and does
  // nothing, and without a second look the key written right after is never
  // read again.
  describe('agent ending while the notification is being deferred', () => {
    let agentStatus: string;

    beforeEach(() => {
      agentStatus = 'running';
      scanServiceClient.getScan.mockImplementation(() =>
        of(scanWithAgent(agentStatus)),
      );
    });

    /**
     * Runs `event` when the deferral key of `scanId` is written: just before
     * the key exists, or just after.
     */
    function atDeferralWrite(
      scanId: string,
      moment: 'before the write' | 'after the write',
      event: () => void | Promise<void>,
    ) {
      const writeToStore = redisMock.set.getMockImplementation();
      redisMock.set.mockImplementation(
        async (key: string, value: string, ...args: unknown[]) => {
          if (key !== `scan-notification-deferred:${scanId}`) {
            return writeToStore(key, value, ...args);
          }
          if (moment === 'before the write') await event();
          const reply = await writeToStore(key, value, ...args);
          if (moment === 'after the write') await event();
          return reply;
        },
      );
    }

    /** What a grpc-js client call rejects with when security-scanning is down. */
    function securityScanningUnavailable() {
      return Object.assign(
        new Error('14 UNAVAILABLE: No connection established'),
        { code: 14, details: 'No connection established' },
      );
    }

    /**
     * Ends the agent when the deferral key is written, and delivers the
     * notifyScanComplete that security-scanning sends when it closes the agent
     * container: just before the key exists, or just after.
     */
    function endAgentAtDeferralWrite(
      scanId: string,
      agentNotification: 'before the write' | 'after the write',
    ) {
      atDeferralWrite(scanId, agentNotification, async () => {
        agentStatus = 'completed';
        await service.notifyScanComplete(scanId);
      });
    }

    it('dispatches once when the agent ends between the pending check and the deferral', async () => {
      endAgentAtDeferralWrite('scan-race', 'before the write');

      await service.onScannerFinalized(
        'scan-race',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
      expect(redisMock._store.has('scan-notification-deferred:scan-race')).toBe(
        false,
      );
    });

    it("dispatches once when the agent's own notification lands right after the deferral", async () => {
      endAgentAtDeferralWrite('scan-race', 'after the write');

      await service.onScannerFinalized(
        'scan-race',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    it('keeps the deferral when the agent is still pending at the re-check', async () => {
      await service.onScannerFinalized(
        'scan-race',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      expect(slackClient.sendNotification).not.toHaveBeenCalled();
      expect(redisMock._store.has('scan-notification-deferred:scan-race')).toBe(
        true,
      );
    });

    // The first check still fails open: with no answer at all about the agent,
    // notifying now beats never notifying.
    it('still notifies at once when the first check cannot reach security-scanning', async () => {
      scanServiceClient.getScan.mockReturnValue(
        throwError(securityScanningUnavailable),
      );
      scanQueueService.getRegisteredScanQueueTypes.mockResolvedValue([
        'sast-iac',
      ]);

      await service.onScannerFinalized(
        'scan-race',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(redisMock._store.has('scan-notification-deferred:scan-race')).toBe(
        false,
      );
    });

    // The agent was running a moment ago, so a re-check that cannot reach
    // security-scanning proves nothing. Dispatching then would send the
    // notification, the issues and the cyber-risk recompute before the AI
    // ends, and consume the key the agent's own notifyScanComplete needs.
    it('keeps the deferral for the agent when the re-check cannot reach security-scanning', async () => {
      let nextGetScanFails = false;
      scanServiceClient.getScan.mockImplementation(() => {
        if (!nextGetScanFails) return of(scanWithAgent(agentStatus));
        nextGetScanFails = false;
        return throwError(securityScanningUnavailable);
      });
      atDeferralWrite('scan-race', 'after the write', () => {
        nextGetScanFails = true;
      });
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      await service.onScannerFinalized(
        'scan-race',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      expect(slackClient.sendNotification).not.toHaveBeenCalled();
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();
      expect(cyberiskEnqueuer.enqueue).not.toHaveBeenCalled();
      expect(redisMock._store.has('scan-notification-deferred:scan-race')).toBe(
        true,
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('scan-race'));

      // The agent ends later, and its own notifyScanComplete dispatches once.
      agentStatus = 'completed';
      await service.notifyScanComplete('scan-race');
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });
  });

  // diff scans (changed-files only, pre-commit/agent) are FULLY
  // isolated — their findings live in the ephemeral diff_scan_finding store and
  // never reach the project's posture/stats/cyber-risk. So onScannerFinalized
  // must NOT notify, create issues, NOR trigger a cyber-risk recompute.
  describe('Diff scan isolation', () => {
    it('skips notifications, issue creation AND cyber-risk recompute for a diff scan', async () => {
      scanServiceClient.getScan.mockReturnValue(
        of({
          containers: [
            { image: 'scanlink-sast-opengrep', status: 'completed' },
          ],
          scanType: 'code',
          branch: 'main',
          isDiffScan: true,
        }),
      );

      await service.onScannerFinalized(
        'scan-diff',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      expect(slackClient.sendNotification).not.toHaveBeenCalled();
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();
      expect(cyberiskEnqueuer.enqueue).not.toHaveBeenCalled();
    });
  });

  // a single getScan now serves both the diff-scan isolation
  // check and the notification's scanType/branch — no redundant round-trip to
  // security-scanning on a normal-scan finalization.
  describe('Single getScan reuse (no redundant round-trip)', () => {
    it('reuses one hoisted getScan for isDiffScan + dispatchNotifications', async () => {
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-reuse',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      // The getScan of getExpectedScannerCounts also serves the
      // agent check, the isDiffScan check and dispatchNotifications (it was
      // 3 calls, then 4 before the diff-scan isolation).
      expect(scanServiceClient.getScan).toHaveBeenCalledTimes(1);
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifyScanComplete (deferred notification trigger)', () => {
    it('should dispatch notification when deferred state exists', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'completed' },
      ]);

      await redisMock.set(
        'scan-notification-deferred:scan-deferred-1',
        JSON.stringify({ projectId: 'proj-1', scannerType: 'sca' }),
      );

      await service.notifyScanComplete('scan-deferred-1');

      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    it('should not dispatch when no deferred state exists', async () => {
      await service.notifyScanComplete('scan-no-deferred');

      expect(slackClient.sendNotification).not.toHaveBeenCalled();
    });

    // defence-in-depth — even the deferred path must
    // not notify or create issues for a diff scan.
    it('skips the deferred notification for a diff scan', async () => {
      scanServiceClient.getScan.mockReturnValue(
        of({
          containers: [],
          scanType: 'code',
          branch: 'main',
          isDiffScan: true,
        }),
      );
      await redisMock.set(
        'scan-notification-deferred:scan-diff-deferred',
        JSON.stringify({ projectId: 'proj-1', scannerType: 'sast-iac' }),
      );

      await service.notifyScanComplete('scan-diff-deferred');

      expect(slackClient.sendNotification).not.toHaveBeenCalled();
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();
    });

    it('should not dispatch twice (lock prevents duplicate)', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'completed' },
      ]);

      await redisMock.set(
        'scan-notification-deferred:scan-dup',
        JSON.stringify({ projectId: 'proj-1', scannerType: 'sca' }),
      );

      await service.notifyScanComplete('scan-dup');
      await service.notifyScanComplete('scan-dup');

      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('should handle full flow: defer then trigger on agent complete', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'running' },
      ]);

      await service.onScannerFinalized(
        'scan-flow',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();

      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'completed' },
      ]);

      await service.notifyScanComplete('scan-flow');
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  // What else runs once a scan has completed comes from the
  // SCAN_COMPLETED_LISTENERS port; the service only calls each listener, once
  // per completed scan, best-effort.
  describe('scan-completed listeners', () => {
    it('calls each listener once per completed scan, with scanId and projectId', async () => {
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-1',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(scanCompletedListener.onScanCompleted).toHaveBeenCalledTimes(1);
      expect(scanCompletedListener.onScanCompleted).toHaveBeenCalledWith(
        'scan-1',
        'proj-1',
      );
    });

    it('calls them before the notifications are dispatched', async () => {
      const order: string[] = [];
      scanCompletedListener.onScanCompleted.mockImplementation(async () => {
        order.push('listener');
      });
      slackClient.sendNotification.mockImplementation(() => {
        order.push('slack');
        return of({ success: true });
      });
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-order',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(order).toEqual(['listener', 'slack']);
    });

    it('calls every listener, even after one that fails', async () => {
      const second = {
        onScanCompleted: jest.fn().mockResolvedValue(undefined),
      };
      scanCompletedListener.onScanCompleted.mockRejectedValue(
        new Error('listener down'),
      );
      await rebuildWithListeners([scanCompletedListener, second]);
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-two',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(second.onScanCompleted).toHaveBeenCalledWith('scan-two', 'proj-1');
      expect(slackClient.sendNotification).toHaveBeenCalled();
    });

    it('is skipped for diff scans', async () => {
      scanServiceClient.getScan.mockReturnValue(
        of({
          containers: [
            { image: 'scanlink-sast-opengrep', status: 'completed' },
          ],
          scanType: 'code',
          branch: 'main',
          isDiffScan: true,
        }),
      );

      await service.onScannerFinalized(
        'scan-diff',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      expect(scanCompletedListener.onScanCompleted).not.toHaveBeenCalled();
    });

    it('never blocks notifications when a listener rejects', async () => {
      scanCompletedListener.onScanCompleted.mockRejectedValue(
        new Error('listener down'),
      );
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-1',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(slackClient.sendNotification).toHaveBeenCalled();
    });

    it('still runs on the deferred path, once the agent finishes', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'completed' },
      ]);

      await redisMock.set(
        'scan-notification-deferred:scan-deferred-1',
        JSON.stringify({ projectId: 'proj-1', scannerType: 'sca' }),
      );

      await service.notifyScanComplete('scan-deferred-1');

      expect(scanCompletedListener.onScanCompleted).toHaveBeenCalledTimes(1);
      expect(scanCompletedListener.onScanCompleted).toHaveBeenCalledWith(
        'scan-deferred-1',
        'proj-1',
      );
    });

    it('never blocks the deferred notification when a listener rejects', async () => {
      scanCompletedListener.onScanCompleted.mockRejectedValue(
        new Error('listener down'),
      );
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'completed' },
      ]);

      await redisMock.set(
        'scan-notification-deferred:scan-deferred-down',
        JSON.stringify({ projectId: 'proj-1', scannerType: 'sca' }),
      );

      await service.notifyScanComplete('scan-deferred-down');

      expect(slackClient.sendNotification).toHaveBeenCalled();
    });

    it('fires exactly once when a scan defers then resumes', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'running' },
      ]);

      await service.onScannerFinalized(
        'scan-flow',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(scanCompletedListener.onScanCompleted).not.toHaveBeenCalled();

      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'completed' },
      ]);

      await service.notifyScanComplete('scan-flow');

      expect(scanCompletedListener.onScanCompleted).toHaveBeenCalledTimes(1);
      expect(scanCompletedListener.onScanCompleted).toHaveBeenCalledWith(
        'scan-flow',
        'proj-1',
      );
    });

    it('notifies when no listener is bound', async () => {
      await rebuildWithListeners(undefined);
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-none',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(slackClient.sendNotification).toHaveBeenCalled();
    });
  });

  // The end of a scan asked security-scanning for the scan
  // N+2 times (once per finalized scanner, then for the agent check and the
  // dispatch) and global-management for the project twice (the notification,
  // then the issue creation). And an exception of the notification skipped
  // the issue creation and the cyber-risk recompute (same try).
  describe('What the end of a scan reads', () => {
    const project = {
      name: 'TestProject',
      scanCompleteSlackEnabled: true,
      scanCompleteEmailEnabled: false,
      githubIssueEnabled: true,
      issueCreationBranches: ['main'],
    };

    beforeEach(() => {
      projectClient.get.mockReturnValue(of(project));
    });

    it('reads the scan once per finalized scanner, and the project once, when the last of 3 finalizes', async () => {
      setupScanContainers([
        { image: 'scanlink-sast-opengrep', status: 'completed' },
        { image: 'scanlink-iac-kics', status: 'completed' },
        { image: 'scanlink-sca', status: 'completed' },
      ]);

      await service.onScannerFinalized(
        'scan-l27',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      // Nothing is kept from one call to the next: each reads the scan.
      expect(scanServiceClient.getScan).toHaveBeenCalledTimes(1);
      await service.onScannerFinalized(
        'scan-l27',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      expect(scanServiceClient.getScan).toHaveBeenCalledTimes(2);
      scanServiceClient.getScan.mockClear();

      await service.onScannerFinalized(
        'scan-l27',
        'proj-1',
        'sast-iac',
        'kics',
      );

      expect(scanServiceClient.getScan).toHaveBeenCalledTimes(1);
      expect(projectClient.get).toHaveBeenCalledTimes(1);
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledWith(
        'proj-1',
        'scan-l27',
        undefined,
        { project, scanBranch: 'main' },
      );
    });

    it('still reads the scan afresh to re-check the agent after deferring', async () => {
      scanServiceClient.getScan.mockReturnValue(of(scanWithAgent('running')));

      await service.onScannerFinalized(
        'scan-l27-agent',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      // The finalization's read, then the re-check after the deferral write.
      expect(scanServiceClient.getScan).toHaveBeenCalledTimes(2);
      expect(
        redisMock._store.has('scan-notification-deferred:scan-l27-agent'),
      ).toBe(true);
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();
    });

    it('hands the project and the branch to the issue creation on the deferred path', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'completed' },
      ]);
      await redisMock.set(
        'scan-notification-deferred:scan-l27-deferred',
        JSON.stringify({ projectId: 'proj-1', scannerType: 'sca' }),
      );

      await service.notifyScanComplete('scan-l27-deferred');

      expect(scanServiceClient.getScan).toHaveBeenCalledTimes(1);
      expect(projectClient.get).toHaveBeenCalledTimes(1);
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledWith(
        'proj-1',
        'scan-l27-deferred',
        undefined,
        { project, scanBranch: 'main' },
      );
    });

    it('creates the issues and recomputes the cyber-risk when the notification throws', async () => {
      projectClient.get.mockReturnValue(
        throwError(() => new Error('14 UNAVAILABLE: global-management')),
      );
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-l27-gm-down',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(slackClient.sendNotification).not.toHaveBeenCalled();
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
      // No project to hand over: the issue creation reads it itself.
      expect(
        issueIntegrationService.createIssuesForScan.mock.calls[0][3].project,
      ).toBeUndefined();
      expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledWith(
        'proj-1',
        'scan_complete',
      );
    });

    it('logs the stack of a dispatch that throws, like the outer catch', async () => {
      projectClient.get.mockReturnValue(
        throwError(() => new Error('14 UNAVAILABLE: global-management')),
      );
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);
      const error = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      await service.onScannerFinalized(
        'scan-l27-stack',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      const dispatchLine = error.mock.calls.find(([message]) =>
        String(message).includes('Failed to dispatch notifications'),
      );
      expect(dispatchLine).toBeDefined();
      // The second argument is the stack trace (Nest's Logger prints it).
      expect(dispatchLine[1]).toEqual(expect.stringContaining('\n    at '));
    });

    it('creates the issues on the deferred path when the notification throws', async () => {
      projectClient.get.mockReturnValue(
        throwError(() => new Error('14 UNAVAILABLE: global-management')),
      );
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-agent', status: 'completed' },
      ]);
      await redisMock.set(
        'scan-notification-deferred:scan-l27-deferred-down',
        JSON.stringify({ projectId: 'proj-1', scannerType: 'sca' }),
      );

      await service.notifyScanComplete('scan-l27-deferred-down');

      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
      expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledTimes(1);
      expect(
        redisMock._store.has(
          'scan-notification-deferred:scan-l27-deferred-down',
        ),
      ).toBe(false);
    });
  });

  // Analysis-reporting alone creates a scan's issues.
  // It evaluated the end of a scan only when one of its scanners finalized,
  // so a scanner whose container failed after the others had finalized left
  // the scan waiting for good ("2/3 scanners finalized. Waiting.", then
  // nothing): security-scanning's own CreateIssuesForScan was
  // the only net. security-scanning now says when every container is closed.
  describe('The end of a scan, from security-scanning', () => {
    const scanners = (kicsStatus: string) => [
      { image: 'scanlink-sast-opengrep', status: 'completed' },
      { image: 'scanlink-iac-kics', status: kicsStatus },
      { image: 'scanlink-sca', status: 'completed' },
    ];

    it('dispatches once when the last scanner fails after the 2 others finalized', async () => {
      setupScanContainers(scanners('running'));
      await service.onScannerFinalized(
        'scan-hole',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      await service.onScannerFinalized(
        'scan-hole',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();

      setupScanContainers(scanners('failed'));
      const outcome = await service.onScanEnded('scan-hole', 'proj-1');

      expect(outcome).toBe('dispatched');
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledWith(
        'proj-1',
        'scan-hole',
        undefined,
        expect.objectContaining({ scanBranch: 'main' }),
      );
      expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledWith(
        'proj-1',
        'scan_complete',
      );

      // A retry of the same word changes nothing.
      expect(await service.onScanEnded('scan-hole', 'proj-1')).toBe(
        'already_dispatched',
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    it('waits for a scanner still being finalized, whose finalization then dispatches once', async () => {
      setupScanContainers(scanners('completed'));
      await service.onScannerFinalized(
        'scan-lag',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(await service.onScanEnded('scan-lag', 'proj-1')).toBe('waiting');
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();

      await service.onScannerFinalized(
        'scan-lag',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      await service.onScannerFinalized(
        'scan-lag',
        'proj-1',
        'sast-iac',
        'kics',
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('neither notifies nor creates issues for a scan none of whose scanners finalized', async () => {
      setupScanContainers([
        { image: 'scanlink-sast-opengrep', status: 'failed' },
        { image: 'scanlink-sca', status: 'failed' },
      ]);

      expect(await service.onScanEnded('scan-all-failed', 'proj-1')).toBe(
        'nothing_finalized',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();
      expect(cyberiskEnqueuer.enqueue).not.toHaveBeenCalled();
    });

    it('dispatches a scan whose only finalized scanner was closed failed afterwards', async () => {
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);
      // Finalized while another scanner still ran, so it waited...
      scanServiceClient.getScan.mockReturnValueOnce(
        of({
          containers: [
            { image: 'scanlink-sca', status: 'running' },
            { image: 'scanlink-sast-opengrep', status: 'running' },
          ],
          scanType: 'full',
          branch: 'main',
        }),
      );
      await service.onScannerFinalized(
        'scan-late-fail',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();

      // ...then both containers were closed failed (time limit). Only SCA had
      // sent results, so only its queue type is registered.
      setupScanContainers([
        { image: 'scanlink-sca', status: 'failed' },
        { image: 'scanlink-sast-opengrep', status: 'failed' },
      ]);
      scanQueueService.getRegisteredScanQueueTypes.mockResolvedValue(['sca']);
      expect(await service.onScanEnded('scan-late-fail', 'proj-1')).toBe(
        'dispatched',
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    // A scanner that sent its last batch and was then
    // closed failed (SCA whose final status report failed, a time limit) is
    // out of the expected count, but its batches may still sit in the queue.
    // Dispatching then sent the notification and created the issues without
    // its findings, and its own finalization found the dispatch done.
    // The same guard on a scanner's finalization. A
    // scanner closed failed before another one finalized, its results still
    // queued, is out of the count: the other's finalization dispatched
    // without them.
    it("waits on a scanner's finalization for a failed scanner whose last batch is still to be finalized", async () => {
      setupScanContainers(scanners('failed'));
      scanQueueService.getScannersAwaitingFinalization.mockImplementation(
        async (queueType: string) => (queueType === 'sast-iac' ? ['kics'] : []),
      );

      await service.onScannerFinalized(
        'scan-fail-first',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      await service.onScannerFinalized(
        'scan-fail-first',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();

      await service.onScannerFinalized(
        'scan-fail-first',
        'proj-1',
        'sast-iac',
        'kics',
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    it('waits for every failed scanner that sent its last batch, then dispatches once', async () => {
      setupScanContainers([
        { image: 'scanlink-sast-opengrep', status: 'completed' },
        { image: 'scanlink-iac-kics', status: 'failed' },
        { image: 'scanlink-sca', status: 'failed' },
      ]);
      scanQueueService.getScannersAwaitingFinalization.mockImplementation(
        async (queueType: string) =>
          queueType === 'sast-iac'
            ? ['kics']
            : queueType === 'sca'
              ? ['scanlink-sca']
              : [],
      );

      await service.onScannerFinalized(
        'scan-two-failed',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      await service.onScannerFinalized(
        'scan-two-failed',
        'proj-1',
        'sast-iac',
        'kics',
      );
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();

      await service.onScannerFinalized(
        'scan-two-failed',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('waits for a failed scanner whose last batch is still to be finalized, whose finalization then dispatches once', async () => {
      setupScanContainers(scanners('running'));
      await service.onScannerFinalized(
        'scan-queued-fail',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      await service.onScannerFinalized(
        'scan-queued-fail',
        'proj-1',
        'sast-iac',
        'opengrep',
      );

      // kics sent its isLast batch, then its container was closed failed.
      setupScanContainers(scanners('failed'));
      scanQueueService.getRegisteredScanQueueTypes.mockResolvedValue([
        'sca',
        'sast-iac',
      ]);
      scanQueueService.getScannersAwaitingFinalization.mockImplementation(
        async (queueType: string) => (queueType === 'sast-iac' ? ['kics'] : []),
      );

      expect(await service.onScanEnded('scan-queued-fail', 'proj-1')).toBe(
        'waiting',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();

      await service.onScannerFinalized(
        'scan-queued-fail',
        'proj-1',
        'sast-iac',
        'kics',
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );

      // kics is finalized but its tracking not cleared yet: it no longer
      // holds anything back.
      expect(await service.onScanEnded('scan-queued-fail', 'proj-1')).toBe(
        'already_dispatched',
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    // With no scanner left to count, one finalized queue
    // type is enough. A type registered without its last batch (a pod killed
    // by the time limit while sending) will never finalize: waiting for it,
    // as onScannerFinalized's fallback would, blocked the scan for good. The
    // scanners that did send their last batch are waited for by the guard.
    it('with every scanner failed, dispatches once one queue type finalized, not waiting for one that never sent its last batch', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'failed' },
        { image: 'scanlink-sast-opengrep', status: 'failed' },
      ]);
      scanQueueService.getRegisteredScanQueueTypes.mockResolvedValue([
        'sca',
        'sast-iac',
      ]);
      await redisMock.sadd('scan-finalized-types:scan-cut-short', 'sca');

      expect(await service.onScanEnded('scan-cut-short', 'proj-1')).toBe(
        'dispatched',
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    it('with every scanner failed, still waits for one that sent its last batch', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'failed' },
        { image: 'scanlink-sast-opengrep', status: 'failed' },
      ]);
      scanQueueService.getRegisteredScanQueueTypes.mockResolvedValue([
        'sca',
        'sast-iac',
      ]);
      scanQueueService.getScannersAwaitingFinalization.mockImplementation(
        async (queueType: string) =>
          queueType === 'sast-iac' ? ['opengrep'] : [],
      );
      await redisMock.sadd('scan-finalized-types:scan-cut-late', 'sca');

      expect(await service.onScanEnded('scan-cut-late', 'proj-1')).toBe(
        'waiting',
      );
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();
    });

    // A scanner whose finalization failed for good (its
    // batch retries spent, then the onFailed gate threw) never finalizes,
    // and security-scanning tells the end once: without this the guard
    // waited for it for good. The scan goes out without its results.
    describe('a scanner whose finalization failed for good', () => {
      let awaiting: Set<string>;

      beforeEach(() => {
        awaiting = new Set(['kics']);
        scanQueueService.getScannersAwaitingFinalization.mockImplementation(
          async (queueType: string) =>
            queueType === 'sast-iac' ? [...awaiting] : [],
        );
        scanQueueService.clearBatchTracking.mockImplementation(
          async (_type: string, _scanId: string, scanner: string) => {
            awaiting.delete(scanner);
          },
        );
      });

      it('no longer holds the end when its container failed', async () => {
        setupScanContainers(scanners('failed'));
        await service.onScannerFinalized(
          'scan-given-up',
          'proj-1',
          'sca',
          'scanlink-sca',
        );
        await service.onScannerFinalized(
          'scan-given-up',
          'proj-1',
          'sast-iac',
          'opengrep',
        );
        expect(
          issueIntegrationService.createIssuesForScan,
        ).not.toHaveBeenCalled();

        await service.onScannerAbandoned(
          'scan-given-up',
          'proj-1',
          'sast-iac',
          'kics',
        );

        expect(scanQueueService.clearBatchTracking).toHaveBeenCalledWith(
          'sast-iac',
          'scan-given-up',
          'kics',
        );
        expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
        expect(
          issueIntegrationService.createIssuesForScan,
        ).toHaveBeenCalledTimes(1);
      });

      it('no longer holds the end when its container completed', async () => {
        setupScanContainers(scanners('completed'));
        await service.onScannerFinalized(
          'scan-given-up-done',
          'proj-1',
          'sca',
          'scanlink-sca',
        );
        await service.onScannerFinalized(
          'scan-given-up-done',
          'proj-1',
          'sast-iac',
          'opengrep',
        );
        expect(
          issueIntegrationService.createIssuesForScan,
        ).not.toHaveBeenCalled();

        await service.onScannerAbandoned(
          'scan-given-up-done',
          'proj-1',
          'sast-iac',
          'kics',
        );

        expect(
          issueIntegrationService.createIssuesForScan,
        ).toHaveBeenCalledTimes(1);
      });

      // A give-up comes after the batch retries and the
      // onFailed gate all failed, so the outage is already more than 15 s
      // old; seconds of retries ran out on a MySQL failover longer than half
      // a minute. A first evaluation runs at once; a failed one goes to a
      // delayed BullMQ job retried for about an hour, with an id of its own
      // (a deterministic jobId silently no-ops while a job of that id is
      // kept).
      describe('when the end cannot be evaluated at once', () => {
        const unreadableOnce = () =>
          scanServiceClient.getScan.mockReturnValueOnce(
            throwError(() => new Error('14 UNAVAILABLE: security-scanning')),
          );

        it('hands the give-up to a delayed job retried for about an hour, which dispatches', async () => {
          setupScanContainers(scanners('failed'));
          await redisMock.sadd(
            'scan-finalized-scanners:scan-given-up-retry:sca',
            'scanlink-sca',
          );
          await redisMock.sadd(
            'scan-finalized-scanners:scan-given-up-retry:sast-iac',
            'opengrep',
          );
          unreadableOnce();

          await service.onScannerAbandoned(
            'scan-given-up-retry',
            'proj-1',
            'sast-iac',
            'kics',
          );

          expect(
            issueIntegrationService.createIssuesForScan,
          ).not.toHaveBeenCalled();
          expect(scanEndQueue.add).toHaveBeenCalledTimes(1);
          const [name, data, opts] = scanEndQueue.add.mock.calls[0];
          expect(name).toBe('give-up-scanner');
          expect(data).toEqual({
            scanId: 'scan-given-up-retry',
            projectId: 'proj-1',
            scannerType: 'sast-iac',
            scannerName: 'kics',
          });
          expect(opts).toEqual(
            expect.objectContaining({
              delay: 60_000,
              attempts: 7,
              backoff: { type: 'exponential', delay: 60_000 },
              jobId: expect.stringMatching(
                /^scan-end-scan-given-up-retry-sast-iac-kics-/,
              ),
            }),
          );
          // 1 min, then 1, 2, 4, 8, 16 and 32 min between the attempts.
          const lastRunAfterMs =
            opts.delay +
            Array.from(
              { length: opts.attempts - 1 },
              (_, i) => opts.backoff.delay * 2 ** i,
            ).reduce((a: number, b: number) => a + b, 0);
          expect(lastRunAfterMs).toBeGreaterThanOrEqual(60 * 60_000);

          // The job runs once security-scanning answers again.
          expect(await service.giveUpScanner(data)).toBe('dispatched');
          expect(
            issueIntegrationService.createIssuesForScan,
          ).toHaveBeenCalledTimes(1);
        });

        // The scan-complete lock must outlive the
        // delayed job's window, or a late attempt sends the mail and Slack
        // a second time.
        it('keeps the scan-complete lock longer than the delayed job retries', async () => {
          unreadableOnce();
          await service.onScannerAbandoned(
            'scan-lock-ttl',
            'proj-1',
            'sast-iac',
            'kics',
          );
          const [, , opts] = scanEndQueue.add.mock.calls[0];
          const windowMs =
            opts.delay +
            Array.from(
              { length: opts.attempts - 1 },
              (_, i) => opts.backoff.delay * 2 ** i,
            ).reduce((a: number, b: number) => a + b, 0);

          setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);
          await service.onScannerFinalized(
            'scan-lock-ttl',
            'proj-1',
            'sca',
            'scanlink-sca',
          );

          const lock = redisMock.set.mock.calls.find(
            ([key]) => key === 'scan-complete-notification:scan-lock-ttl',
          );
          expect(lock).toBeDefined();
          const ttlSec = lock[3];
          expect(lock[2]).toBe('EX');
          expect(ttlSec * 1000).toBeGreaterThan(windowMs);
          expect(ttlSec).toBeGreaterThanOrEqual(2 * 3600);
        });

        it('gives every give-up a job id of its own', async () => {
          unreadableOnce();
          await service.onScannerAbandoned(
            'scan-given-up-twice',
            'proj-1',
            'sast-iac',
            'kics',
          );
          unreadableOnce();
          await service.onScannerAbandoned(
            'scan-given-up-twice',
            'proj-1',
            'sast-iac',
            'kics',
          );

          const ids = scanEndQueue.add.mock.calls.map(
            ([, , opts]) => opts.jobId,
          );
          expect(ids).toHaveLength(2);
          expect(ids[0]).not.toBe(ids[1]);
        });

        it('lets the job retry: giveUpScanner throws when the end cannot be evaluated', async () => {
          unreadableOnce();

          await expect(
            service.giveUpScanner({
              scanId: 'scan-given-up-unreadable',
              projectId: 'proj-1',
              scannerType: 'sast-iac',
              scannerName: 'kics',
            }),
          ).rejects.toThrow();
        });

        it('never throws, even when the delayed job cannot be queued', async () => {
          unreadableOnce();
          scanEndQueue.add.mockRejectedValue(new Error('ECONNRESET'));
          const error = jest
            .spyOn((service as any).logger, 'error')
            .mockImplementation(() => undefined);

          await expect(
            service.onScannerAbandoned(
              'scan-given-up-lost',
              'proj-1',
              'sast-iac',
              'kics',
            ),
          ).resolves.toBeUndefined();
          expect(error).toHaveBeenCalledTimes(1);
        });
      });
    });

    // With every container closed, a scanner's
    // finalization follows the rule of onScanEnded (one finalized queue type,
    // plus the guard), not the registered-types fallback, which only serves
    // when the scan cannot be read. Otherwise this order blocked the scan
    // for good: security-scanning's notice first (nothing finalized yet),
    // then the finalization of the only scanner with results, which waited
    // for a type registered without its last batch.
    it('dispatches once when the notice comes first and the last finalization follows, every container failed', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'failed' },
        { image: 'scanlink-sast-opengrep', status: 'failed' },
      ]);
      scanQueueService.getRegisteredScanQueueTypes.mockResolvedValue([
        'sca',
        'sast-iac',
      ]);
      scanQueueService.getScannersAwaitingFinalization.mockImplementation(
        async (queueType: string) =>
          queueType === 'sca' ? ['scanlink-sca'] : [],
      );

      expect(await service.onScanEnded('scan-notice-first', 'proj-1')).toBe(
        'nothing_finalized',
      );
      await service.onScannerFinalized(
        'scan-notice-first',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
      expect(slackClient.sendNotification).toHaveBeenCalledTimes(1);
    });

    // The "every container closed" test, not "no scanner counted": an AI-BOM
    // container is in no category, so an AI-BOM still running leaves the
    // count empty too. Its end (security-scanning's notice) decides.
    it('does not take the every-container-closed rule while an AI-BOM container still runs', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'failed' },
        { image: 'scanlink-aibom', status: 'running' },
      ]);
      scanQueueService.getRegisteredScanQueueTypes.mockResolvedValue(['sca']);

      await service.onScannerFinalized(
        'scan-aibom-running',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();

      setupScanContainers([
        { image: 'scanlink-sca', status: 'failed' },
        { image: 'scanlink-aibom', status: 'completed' },
      ]);
      expect(await service.onScanEnded('scan-aibom-running', 'proj-1')).toBe(
        'dispatched',
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    // The Gitleaks pod sends
    // its secrets through the SAST/IaC queue and finalizes under 'sast-iac',
    // and the issue creation reads secret detections. Its container was in
    // no category, so the last counted scanner dispatched while Gitleaks was
    // still sending: its secrets never got an issue (on dev, security-
    // scanning's CreateIssuesForScan ran once every container was closed).
    it('waits for the Gitleaks container before dispatching', async () => {
      setupScanContainers([
        { image: 'scanlink-sast-opengrep', status: 'completed' },
        { image: 'scanlink-secret-gitleaks', status: 'running' },
      ]);

      await service.onScannerFinalized(
        'scan-secrets',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();

      setupScanContainers([
        { image: 'scanlink-sast-opengrep', status: 'completed' },
        { image: 'scanlink-secret-gitleaks', status: 'completed' },
      ]);
      await service.onScannerFinalized(
        'scan-secrets',
        'proj-1',
        'sast-iac',
        'gitleaks',
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    // A scan read without any container reads the
    // same on both paths (as unread: the category-level fallback), where the
    // finalization fell back and the notice took "every container closed".
    it('reads a scan without containers the same way on both paths', async () => {
      scanServiceClient.getScan.mockReturnValue(
        of({ containers: [], scanType: 'full', branch: 'main' }),
      );
      scanQueueService.getRegisteredScanQueueTypes.mockResolvedValue([
        'sca',
        'sast-iac',
      ]);
      await redisMock.sadd('scan-finalized-types:scan-no-containers', 'sca');

      expect(await service.onScanEnded('scan-no-containers', 'proj-1')).toBe(
        'waiting',
      );
      await service.onScannerFinalized(
        'scan-no-containers',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();

      await service.onScannerFinalized(
        'scan-no-containers',
        'proj-1',
        'sast-iac',
        'opengrep',
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    // The fallback's wait says which registered
    // queue types it waits for.
    it('warns with the missing queue types when the fallback waits', async () => {
      scanServiceClient.getScan.mockReturnValue(
        throwError(() => new Error('14 UNAVAILABLE: security-scanning')),
      );
      scanQueueService.getRegisteredScanQueueTypes.mockResolvedValue([
        'sca',
        'sast-iac',
        'container',
      ]);
      const warn = jest.spyOn((service as any).logger, 'warn');

      await service.onScannerFinalized(
        'scan-fallback-wait',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      const line = warn.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes('registered queue types'));
      expect(line).toContain('scan-fallback-wait');
      expect(line).toContain('sast-iac, container');
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();
    });

    // A diff scan answers `diff_scan` only once its scanners are finalized
    // (before that, `waiting` or `nothing_finalized` as for any scan:
    // scan-complete-notification.results-final.spec.ts), and dispatches
    // nothing then.
    it('does nothing for a diff scan whose scanners are finalized', async () => {
      scanServiceClient.getScan.mockReturnValue(
        of({
          containers: [
            { image: 'scanlink-sast-opengrep', status: 'completed' },
          ],
          isDiffScan: true,
          scanType: 'full',
          branch: 'main',
        }),
      );
      await redisMock.sadd(
        'scan-finalized-scanners:scan-diff:sast-iac',
        'opengrep',
      );
      await redisMock.sadd('scan-finalized-types:scan-diff', 'sast-iac');

      expect(await service.onScanEnded('scan-diff', 'proj-1')).toBe(
        'diff_scan',
      );
      expect(slackClient.sendNotification).not.toHaveBeenCalled();
      expect(
        issueIntegrationService.createIssuesForScan,
      ).not.toHaveBeenCalled();
      expect(redisMock._store.has('scan-complete-notification:scan-diff')).toBe(
        false,
      );
    });

    it('throws, having taken no lock, when the scan cannot be read: the caller retries', async () => {
      scanServiceClient.getScan.mockReturnValue(
        throwError(() => new Error('14 UNAVAILABLE: security-scanning')),
      );

      await expect(
        service.onScanEnded('scan-unreadable', 'proj-1'),
      ).rejects.toThrow();
      expect(
        redisMock._store.has('scan-complete-notification:scan-unreadable'),
      ).toBe(false);

      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);
      await service.onScannerFinalized(
        'scan-unreadable',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    it('creates the issues once per scan, even when the scan-complete lock has expired', async () => {
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);
      await service.onScannerFinalized(
        'scan-claim',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      expect(redisMock.set).toHaveBeenCalledWith(
        'scan-issues:scan-claim',
        '1',
        'EX',
        604_800,
        'NX',
      );

      // The one-hour scan-complete lock is gone: a late word dispatches the
      // notification again, never the issues.
      redisMock._store.delete('scan-complete-notification:scan-claim');
      expect(await service.onScanEnded('scan-claim', 'proj-1')).toBe(
        'dispatched',
      );

      expect(slackClient.sendNotification).toHaveBeenCalledTimes(2);
      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    // Neither path locks the other out, so the end is
    // right only if a finalization adds its scanner before it reads the
    // containers, and the end reads the containers before the finalized
    // sets: whichever runs last then sees both facts.
    it('reads in the order both paths rely on', async () => {
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-sast-opengrep', status: 'running' },
      ]);
      await service.onScannerFinalized(
        'scan-order',
        'proj-1',
        'sca',
        'scanlink-sca',
      );
      const added = redisMock.sadd.mock.calls.findIndex(
        ([key]) => key === 'scan-finalized-scanners:scan-order:sca',
      );
      expect(redisMock.sadd.mock.invocationCallOrder[added]).toBeLessThan(
        scanServiceClient.getScan.mock.invocationCallOrder[0],
      );

      redisMock.scard.mockClear();
      redisMock.smembers.mockClear();
      scanServiceClient.getScan.mockClear();
      setupScanContainers([
        { image: 'scanlink-sca', status: 'completed' },
        { image: 'scanlink-sast-opengrep', status: 'failed' },
      ]);
      await service.onScanEnded('scan-order', 'proj-1');

      const setReads = [
        ...redisMock.scard.mock.invocationCallOrder,
        ...redisMock.smembers.mock.invocationCallOrder,
      ];
      expect(setReads.length).toBeGreaterThan(0);
      expect(Math.min(...setReads)).toBeGreaterThan(
        scanServiceClient.getScan.mock.invocationCallOrder[0],
      );
    });

    // A creation that failed (a global-management or
    // external-integrations error) gives the claim back, or it would block
    // the next attempt for 7 days. The integrations look an issue up before
    // creating it, so another attempt is safe.
    it.each([
      [
        'answers success: false',
        () =>
          issueIntegrationService.createIssuesForScan.mockResolvedValueOnce({
            success: false,
            message: '14 UNAVAILABLE: external-integrations',
          }),
      ],
      [
        'throws',
        () =>
          issueIntegrationService.createIssuesForScan.mockRejectedValueOnce(
            new Error('14 UNAVAILABLE: global-management'),
          ),
      ],
    ])(
      'gives the claim back when the issue creation %s, so a later dispatch creates them',
      async (_label, failOnce) => {
        failOnce();
        setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

        await service.onScannerFinalized(
          'scan-claim-back',
          'proj-1',
          'sca',
          'scanlink-sca',
        );
        expect(redisMock._store.has('scan-issues:scan-claim-back')).toBe(false);

        redisMock._store.delete('scan-complete-notification:scan-claim-back');
        await service.onScanEnded('scan-claim-back', 'proj-1');

        expect(
          issueIntegrationService.createIssuesForScan,
        ).toHaveBeenCalledTimes(2);
        expect(redisMock._store.has('scan-issues:scan-claim-back')).toBe(true);
      },
    );

    it('still creates the issues when the claim cannot be written', async () => {
      const set = redisMock.set.getMockImplementation();
      redisMock.set.mockImplementation(
        async (key: string, value: string, ...args: any[]) => {
          if (key.startsWith('scan-issues:')) {
            throw new Error('ECONNRESET');
          }
          return set(key, value, ...args);
        },
      );
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-claim-down',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
    });

    // Step 7 asks to rule out an exception of a scan-completed listener
    // skipping the issue creation that follows it in the same try: the
    // service swallows its errors, a synchronous throw included.
    it('creates the issues when a scan-completed listener throws', async () => {
      scanCompletedListener.onScanCompleted.mockImplementation(() => {
        throw new Error('listener not ready');
      });
      setupScanContainers([{ image: 'scanlink-sca', status: 'completed' }]);

      await service.onScannerFinalized(
        'scan-listener-throws',
        'proj-1',
        'sca',
        'scanlink-sca',
      );

      expect(issueIntegrationService.createIssuesForScan).toHaveBeenCalledTimes(
        1,
      );
      expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledTimes(1);
    });
  });
});
