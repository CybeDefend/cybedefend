import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClientGrpc } from '@nestjs/microservices';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { status } from '@grpc/grpc-js';

import { ScanStateManager } from './scanStateManager';
import { Scan } from '../../../entities/scan.entity';
import { Container } from '../../../entities/container.entity';
import { FileManagementService } from '../../file/file-management.service';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { Logger } from 'nestjs-pino';
import { SCAN_LIFECYCLE_HOOKS } from 'src/edition/ports/scan-lifecycle-hooks.port';

// The conditional UPDATE a scan state is written with:
// `createQueryBuilder().update(Scan).set(...).where(...).andWhere(...)
// .execute()`. It matches the row by default (1 row affected).
const conditionalUpdateMock = () => {
  const qb: any = { execute: jest.fn().mockResolvedValue({ affected: 1 }) };
  for (const step of ['update', 'set', 'where', 'andWhere']) {
    qb[step] = jest.fn(() => qb);
  }
  return qb;
};

const repoMock = () => {
  const m: any = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(async (entity: any) => entity),
    create: jest.fn((x: any) => x),
  };
  m.stateUpdate = conditionalUpdateMock();
  m.createQueryBuilder = jest.fn(() => m.stateUpdate);
  return m;
};

/** What the conditional UPDATE of the scan wrote, or undefined. */
const writtenScan = (repo: ReturnType<typeof repoMock>) =>
  repo.stateUpdate.set.mock.calls[0]?.[0];

/**
 * A scan whose results analysis-reporting already finalized: closing its last
 * container writes the terminal state at once. Without it, the scan is held
 * in `running` until they are (scanStateManager.results-hold.spec.ts).
 */
const resultsFinal = () => ({ resultsFinalizedAt: new Date() });

const loggerMock = () => ({
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
});

describe('ScanStateManager', () => {
  let module: TestingModule;
  let manager: ScanStateManager;
  let scanRepo: ReturnType<typeof repoMock>;
  let containerRepo: ReturnType<typeof repoMock>;
  let realtimePublish: jest.Mock;
  let onScanClosed: jest.Mock;
  let createIssuesForScan: jest.Mock;
  let notifyScanEnded: jest.Mock;
  let deleteFile: jest.Mock;
  let logger: ReturnType<typeof loggerMock>;

  beforeEach(async () => {
    scanRepo = repoMock();
    onScanClosed = jest.fn();
    realtimePublish = jest.fn().mockResolvedValue(undefined);
    containerRepo = repoMock();
    createIssuesForScan = jest.fn(() => of({ success: true }));
    notifyScanEnded = jest.fn(() => of({ success: true, message: 'waiting' }));
    deleteFile = jest.fn().mockResolvedValue({});
    logger = loggerMock();
    const arClient: Partial<ClientGrpc> = {
      getService: jest
        .fn()
        .mockReturnValue({ createIssuesForScan, notifyScanEnded }),
    };
    const policyClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({
        evaluatePolicy: jest.fn(() => of({})),
      }),
    };

    module = await Test.createTestingModule({
      providers: [
        ScanStateManager,
        { provide: getRepositoryToken(Scan), useValue: scanRepo },
        { provide: getRepositoryToken(Container), useValue: containerRepo },
        {
          provide: FileManagementService,
          useValue: { deleteFile },
        },
        {
          provide: 'ANALYSIS_REPORTING_SERVICE',
          useValue: arClient,
        },
        {
          provide: 'POLICY_MANAGEMENT_SERVICE',
          useValue: policyClient,
        },
        {
          provide: RealtimeEventPublisher,
          useValue: { publish: realtimePublish },
        },
        { provide: Logger, useValue: logger },
        { provide: SCAN_LIFECYCLE_HOOKS, useValue: { onScanClosed } },
      ],
    }).compile();

    manager = module.get(ScanStateManager);
    manager.onModuleInit();
  });

  afterEach(async () => {
    await module.close();
  });

  describe('updateScanState — errorMessage clearing', () => {
    it('should clear errorMessage when state transitions from failed to running', async () => {
      const scan = {
        id: 'scan-1',
        state: 'failed',
        errorMessage: 'Processing error: upstream request timeout',
        containers: [
          {
            id: 'c1',
            status: 'running',
            image: 'cybedefend-scanners/sast',
            podName: 'pod-1',
          },
          {
            id: 'c2',
            status: 'completed',
            image: 'cybedefend-scanners/sca',
            podName: 'pod-2',
          },
        ],
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(scan.state).toBe('running');
      expect(scan.errorMessage).toBeNull();
      expect(writtenScan(scanRepo)).toEqual(
        expect.objectContaining({ state: 'running', errorMessage: null }),
      );
    });

    it('should NOT clear errorMessage when state remains failed', async () => {
      const scan = {
        id: 'scan-2',
        state: 'failed',
        errorMessage: 'All scanners failed',
        containers: [
          {
            id: 'c1',
            status: 'failed',
            image: 'cybedefend-scanners/sast',
            podName: 'pod-1',
          },
          {
            id: 'c2',
            status: 'failed',
            image: 'cybedefend-scanners/sca',
            podName: 'pod-2',
          },
        ],
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(scan.state).toBe('failed');
      expect(scan.errorMessage).toBe('All scanners failed');
    });

    it('should clear errorMessage when state transitions from failed to completed', async () => {
      const scan = {
        id: 'scan-3',
        ...resultsFinal(),
        state: 'failed',
        errorMessage: 'Processing error: upstream request timeout',
        containers: [
          {
            id: 'c1',
            status: 'completed',
            image: 'cybedefend-scanners/sast',
            podName: 'pod-1',
          },
          {
            id: 'c2',
            status: 'completed',
            image: 'cybedefend-scanners/sca',
            podName: 'pod-2',
          },
        ],
      } as unknown as Scan;

      // Stub handleCompletedScan to avoid side effects
      jest
        .spyOn(manager as any, 'handleCompletedScan')
        .mockResolvedValue(undefined);

      await manager.updateScanState(scan);

      expect(scan.state).toBe('completed');
      expect(scan.errorMessage).toBeNull();
    });

    it('clears the WHOLE error triplet when recovering from failed to running', async () => {
      const scan = {
        id: 'scan-recover-running',
        state: 'failed',
        errorCode: 500,
        errorCategory: 'SCANNER_CRASH',
        errorMessage: 'transient gRPC timeout',
        containers: [
          {
            id: 'c1',
            status: 'running',
            image: 'cybedefend-scanners/sast',
            podName: 'pod-1',
          },
          {
            id: 'c2',
            status: 'completed',
            image: 'cybedefend-scanners/sca',
            podName: 'pod-2',
          },
        ],
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(scan.state).toBe('running');
      expect(scan.errorMessage).toBeNull();
      expect(scan.errorCode).toBeNull();
      expect(scan.errorCategory).toBeNull();
    });

    it('clears the WHOLE error triplet when recovering from failed to completed', async () => {
      const scan = {
        id: 'scan-recover-completed',
        ...resultsFinal(),
        state: 'failed',
        errorCode: 500,
        errorCategory: 'SCANNER_CRASH',
        errorMessage: 'transient gRPC timeout',
        containers: [
          {
            id: 'c1',
            status: 'completed',
            image: 'cybedefend-scanners/sast',
            podName: 'pod-1',
          },
          {
            id: 'c2',
            status: 'completed',
            image: 'cybedefend-scanners/sca',
            podName: 'pod-2',
          },
        ],
      } as unknown as Scan;

      jest
        .spyOn(manager as any, 'handleCompletedScan')
        .mockResolvedValue(undefined);

      await manager.updateScanState(scan);

      expect(scan.state).toBe('completed');
      expect(scan.errorMessage).toBeNull();
      expect(scan.errorCode).toBeNull();
      expect(scan.errorCategory).toBeNull();
    });
  });

  /**
   * AI-BOM is "optional" for the global scan state: it may depend on an
   * external LLM gateway, whose outage would otherwise degrade every scan
   * with AI-BOM enabled by default. We treat aibom-only failure the same way we
   * treat agent / container-scanner failure: scan still passes as
   * 'completed', not 'completed_degraded'.
   */
  describe('updateScanState — aibom is optional', () => {
    it('completes the scan as "completed" (not "completed_degraded") when only the aibom container failed', async () => {
      const scan = {
        id: 'scan-aibom-z1',
        ...resultsFinal(),
        state: 'running',
        containers: [
          {
            id: 'c1',
            status: 'completed',
            image: 'cybedefend-scanners/sast',
            podName: 'pod-sast',
          },
          {
            id: 'c2',
            status: 'completed',
            image: 'cybedefend-scanners/sca',
            podName: 'pod-sca',
          },
          {
            id: 'c3',
            status: 'failed',
            image: 'cybedefend-scanners/aibom-cisco',
            podName: 'pod-aibom',
          },
        ],
      } as unknown as Scan;

      jest
        .spyOn(manager as any, 'handleCompletedScan')
        .mockResolvedValue(undefined);

      await manager.updateScanState(scan);

      expect(scan.state).toBe('completed');
    });

    it('calculateScanStatus also treats an aibom-only failure as completed', async () => {
      // The test module's containerRepo.find is the same shared mock used by
      // updateScanState; stub its `find` result for calculateScanStatus.
      const containers = [
        {
          id: 'c1',
          status: 'completed',
          image: 'cybedefend-scanners/sast',
          podName: 'pod-sast',
        },
        {
          id: 'c2',
          status: 'failed',
          image: 'cybedefend-scanners/aibom-cisco',
          podName: 'pod-aibom',
        },
      ];
      const containerRepo = (manager as any).containerRepository;
      containerRepo.find.mockResolvedValueOnce(containers);

      const result = await manager.calculateScanStatus('scan-z1');
      expect(result).toBe('completed');
    });
  });

  // `parsing_completed` is the agent waiting for its AI analysis. Counted
  // nowhere, such a scan would be computed `completed` / `completed_degraded`
  // BEFORE its AI ran, then reopened when the analysis started. It is in progress, like
  // `running` and `starting`, and handleCompletedScan runs once, when the
  // agent closes.
  describe('updateScanState — parsing_completed is in progress', () => {
    const containers = (agentStatus: string, sca = 'completed') => [
      {
        id: 'c1',
        status: 'completed',
        image: 'cybedefend-scanners/sast',
        podName: 'p1',
      },
      {
        id: 'c2',
        status: sca,
        image: 'cybedefend-scanners/sca',
        podName: 'p2',
      },
      {
        id: 'a1',
        status: agentStatus,
        image: 'agent-service',
        podName: 'agent-1',
      },
    ];

    it('keeps the scan running and does not complete it', async () => {
      const handleCompleted = jest.spyOn(manager, 'handleCompletedScan');
      const scan = {
        id: 's1',
        state: 'running',
        containers: containers('parsing_completed'),
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(scan.state).toBe('running');
      expect(scan.endTime).toBeUndefined();
      expect(handleCompleted).not.toHaveBeenCalled();
    });

    it('keeps it running even with a mandatory scanner failed', async () => {
      const handleCompleted = jest.spyOn(manager, 'handleCompletedScan');
      const scan = {
        id: 's2',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'running',
        containers: containers('parsing_completed', 'failed'),
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(scan.state).toBe('running');
      expect(handleCompleted).not.toHaveBeenCalled();
      // No bogus running → completed_degraded → running round trip.
      expect(realtimePublish).not.toHaveBeenCalled();
    });

    it('reaches its terminal state, once, when the agent closes', async () => {
      const handleCompleted = jest
        .spyOn(manager, 'handleCompletedScan')
        .mockResolvedValue(undefined);
      const scan = {
        id: 's3',
        ...resultsFinal(),
        state: 'running',
        containers: containers('completed', 'failed'),
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(scan.state).toBe('completed_degraded');
      expect(handleCompleted).toHaveBeenCalledTimes(1);
    });

    // closeAgentContainer no longer forces the scan's
    // state: a timed-out or failed analysis closes the agent `failed`, and
    // the recompute must still call a scan whose scanners all succeeded
    // `completed` — a missing Cybe analysis is not a scan failure.
    it('completes the scan when the agent closed failed beside completed scanners', async () => {
      jest.spyOn(manager, 'handleCompletedScan').mockResolvedValue(undefined);
      const scan = {
        id: 's6',
        ...resultsFinal(),
        state: 'running',
        errorMessage: null,
        containers: containers('failed'),
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(scan.state).toBe('completed');
      expect(scan.errorMessage).toBeNull();
    });

    it('calculateScanStatus agrees', async () => {
      const containerRepo = (manager as any).containerRepository;
      containerRepo.find.mockResolvedValueOnce(
        containers('parsing_completed', 'failed'),
      );

      await expect(manager.calculateScanStatus('s4')).resolves.toBe('running');
    });

    it('calculateScanStatus keeps an all-scanners-done scan running while the agent waits', async () => {
      const containerRepo = (manager as any).containerRepository;
      containerRepo.find.mockResolvedValueOnce(containers('parsing_completed'));

      await expect(manager.calculateScanStatus('s5')).resolves.toBe('running');
    });
  });

  // An optional container's failure (agent, container scanner, AI-BOM) must
  // never change the scan state, degraded included: a degraded SAST beside a
  // failed agent keeps its degraded state. Closing the agent `failed` on a
  // timeout or an analysis failure makes that case routine.
  describe('updateScanState — an optional failure never changes the scan state', () => {
    const sast = (status: string) => ({
      id: 'c1',
      status,
      image: 'cybedefend-scanners/sast',
      podName: 'p1',
    });
    const sca = (status: string) => ({
      id: 'c2',
      status,
      image: 'cybedefend-scanners/sca',
      podName: 'p2',
    });
    const aibom = (status: string) => ({
      id: 'c3',
      status,
      image: 'cybedefend-scanners/aibom-cisco',
      podName: 'p3',
    });
    const agent = (status: string) => ({
      id: 'a1',
      status,
      image: 'agent-service',
      podName: 'agent-1',
    });
    const calculate = (containers: unknown[]) => {
      (manager as any).containerRepository.find.mockResolvedValueOnce(
        containers,
      );
      return manager.calculateScanStatus('s-calc');
    };

    it('keeps a degraded scan degraded when the agent failed, and completes it once', async () => {
      const handleCompleted = jest
        .spyOn(manager, 'handleCompletedScan')
        .mockResolvedValue(undefined);
      const scan = {
        id: 's-deg',
        ...resultsFinal(),
        state: 'running',
        containers: [sast('completed_degraded'), agent('failed')],
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(scan.state).toBe('completed_degraded');
      expect(handleCompleted).toHaveBeenCalledTimes(1);
    });

    it('calculateScanStatus keeps it degraded too', async () => {
      await expect(
        calculate([sast('completed_degraded'), agent('failed')]),
      ).resolves.toBe('completed_degraded');
    });

    it('keeps it degraded whichever optional container failed', async () => {
      const scan = {
        id: 's-deg-aibom',
        ...resultsFinal(),
        state: 'running',
        containers: [
          sast('completed_degraded'),
          sca('completed'),
          aibom('failed'),
        ],
      } as unknown as Scan;
      jest.spyOn(manager, 'handleCompletedScan').mockResolvedValue(undefined);

      await manager.updateScanState(scan);

      expect(scan.state).toBe('completed_degraded');
      await expect(
        calculate([
          sast('completed_degraded'),
          sca('completed'),
          aibom('failed'),
        ]),
      ).resolves.toBe('completed_degraded');
    });

    // Guards: behaviour that must not move.
    it('still completes a clean scan whose agent failed', async () => {
      jest.spyOn(manager, 'handleCompletedScan').mockResolvedValue(undefined);
      const scan = {
        id: 's-clean',
        ...resultsFinal(),
        state: 'running',
        containers: [sast('completed'), agent('failed')],
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(scan.state).toBe('completed');
      await expect(
        calculate([sast('completed'), agent('failed')]),
      ).resolves.toBe('completed');
    });

    it('still degrades a scan with a mandatory failure', async () => {
      jest.spyOn(manager, 'handleCompletedScan').mockResolvedValue(undefined);
      const containers = [
        sast('failed'),
        sca('completed_degraded'),
        agent('failed'),
      ];
      const scan = {
        id: 's-mandatory',
        ...resultsFinal(),
        state: 'running',
        containers,
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(scan.state).toBe('completed_degraded');
      await expect(calculate(containers)).resolves.toBe('completed_degraded');
    });
  });

  describe('updateScanState — realtime', () => {
    it('publishes SCAN_STATUS_CHANGED when state transitions from queued to running', async () => {
      const scan: any = {
        id: 's1',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'queued',
        containers: [{ status: 'running', image: 'sast', podName: '' }],
      };
      await manager.updateScanState(scan);
      expect(realtimePublish).toHaveBeenCalledTimes(1);
      expect(realtimePublish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SCAN_STATUS_CHANGED',
          scope: { organizationId: 'o1', projectId: 'p1', scanId: 's1' },
          payload: {
            scanStatusChanged: {
              scanId: 's1',
              previousState: 'queued',
              currentState: 'running',
            },
          },
        }),
        // Cross-process dedupe — parallel container updates that all
        // observe the same stale previousState should still trigger
        // at most one publish per logical target state.
        expect.objectContaining({
          dedupeKey: 'scan:s1:state:running',
          dedupeTtlSec: expect.any(Number),
        }),
      );
      expect(scan.state).toBe('running');
    });

    it('does NOT publish when computed state equals previous state', async () => {
      const scan: any = {
        id: 's1',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'running',
        containers: [{ status: 'running', image: 'sast', podName: '' }],
      };
      await manager.updateScanState(scan);
      expect(realtimePublish).not.toHaveBeenCalled();
    });

    it('includes error triplet in scanStatusChanged payload when transitioning to "failed"', async () => {
      const scan: any = {
        id: 's-fail',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'running',
        errorCode: 500,
        errorCategory: 'SCANNER_CRASH',
        errorMessage: 'All scanners exited with code 1',
        containers: [
          {
            status: 'failed',
            image: 'cybedefend-scanners/sast',
            podName: 'pod-sast',
          },
          {
            status: 'failed',
            image: 'cybedefend-scanners/sca',
            podName: 'pod-sca',
          },
        ],
      };

      jest
        .spyOn(manager as any, 'handleCompletedScan')
        .mockResolvedValue(undefined);

      await manager.updateScanState(scan);

      expect(scan.state).toBe('failed');
      expect(realtimePublish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SCAN_STATUS_CHANGED',
          payload: {
            scanStatusChanged: {
              scanId: 's-fail',
              previousState: 'running',
              currentState: 'failed',
              errorCode: 500,
              errorCategory: 'SCANNER_CRASH',
              errorMessage: 'All scanners exited with code 1',
            },
          },
        }),
        expect.objectContaining({ dedupeKey: 'scan:s-fail:state:failed' }),
      );
    });

    it('includes the FULL error triplet in scanStatusChanged payload when transitioning to "completed_degraded"', async () => {
      // `completed_degraded` IS a failure outcome, so the state-transition
      // recovery logic must NOT clear its error triplet — errorCode,
      // errorCategory AND errorMessage are all preserved and published.
      const scan: any = {
        id: 's-degraded',
        ...resultsFinal(),
        organizationId: 'o1',
        projectId: 'p1',
        state: 'running',
        errorCode: 503,
        errorCategory: 'PARTIAL_FAILURE',
        errorMessage: 'One mandatory scanner failed',
        containers: [
          {
            status: 'completed',
            image: 'cybedefend-scanners/sca',
            podName: 'pod-sca',
          },
          {
            status: 'completed_degraded',
            image: 'cybedefend-scanners/sast',
            podName: 'pod-sast',
          },
        ],
      };

      jest
        .spyOn(manager as any, 'handleCompletedScan')
        .mockResolvedValue(undefined);

      await manager.updateScanState(scan);

      expect(scan.state).toBe('completed_degraded');
      expect(realtimePublish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SCAN_STATUS_CHANGED',
          payload: {
            scanStatusChanged: {
              scanId: 's-degraded',
              previousState: 'running',
              currentState: 'completed_degraded',
              errorCode: 503,
              errorCategory: 'PARTIAL_FAILURE',
              errorMessage: 'One mandatory scanner failed',
            },
          },
        }),
        expect.objectContaining({
          dedupeKey: 'scan:s-degraded:state:completed_degraded',
        }),
      );
    });

    it('omits error fields from scanStatusChanged payload when transitioning to a non-failure state', async () => {
      const scan: any = {
        id: 's-ok',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'queued',
        errorCode: 500,
        errorCategory: 'PREVIOUS_ERROR',
        errorMessage: 'stale error from previous run',
        containers: [
          { status: 'running', image: 'cybedefend-scanners/sast', podName: '' },
        ],
      };

      await manager.updateScanState(scan);

      expect(scan.state).toBe('running');
      expect(realtimePublish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SCAN_STATUS_CHANGED',
          payload: {
            scanStatusChanged: {
              scanId: 's-ok',
              previousState: 'queued',
              currentState: 'running',
            },
          },
        }),
        expect.anything(),
      );
      // Confirm no error fields leaked into the payload
      const publishedPayload =
        realtimePublish.mock.calls[0][0].payload.scanStatusChanged;
      expect(publishedPayload).not.toHaveProperty('errorCode');
      expect(publishedPayload).not.toHaveProperty('errorCategory');
      expect(publishedPayload).not.toHaveProperty('errorMessage');
    });
  });

  // A scan cancelled by the stalled-queue watchdog carries the reason it was
  // cancelled (errorCode 65). Two things could destroy it: the state is
  // recomputed from the containers, which never yields `cancelled`, and
  // `cancelled` must be in the list of states that keep the error triplet.
  // Cancellation is a terminal decision — `updateScanData` and `startScan`
  // already refuse to override it; so must this path.
  describe('updateScanState — a cancelled scan is left alone', () => {
    const cancelledScan = (containers: unknown[] = []) =>
      ({
        id: 's-cancelled',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'cancelled',
        errorCode: 65,
        errorCategory: 'infra',
        errorMessage: 'waited too long for a free scan slot',
        containers,
      }) as unknown as Scan;

    it('keeps the state and the whole error triplet of a cancelled scan', async () => {
      const scan = cancelledScan();

      await manager.updateScanState(scan);

      expect(scan.state).toBe('cancelled');
      expect(scan.errorCode).toBe(65);
      expect(scan.errorCategory).toBe('infra');
      expect(scan.errorMessage).toBe('waited too long for a free scan slot');
      expect(scanRepo.save).not.toHaveBeenCalled();
      expect(scanRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(realtimePublish).not.toHaveBeenCalled();
    });

    it('is not resurrected by a late container report', async () => {
      const scan = cancelledScan([
        {
          id: 'c1',
          status: 'completed',
          image: 'cybedefend-scanners/sast',
          podName: 'p',
        },
      ]);

      await manager.updateScanState(scan);

      expect(scan.state).toBe('cancelled');
      expect(scan.errorCode).toBe(65);
    });
  });

  // The closed work a terminal scan triggers (closed extension) lives behind
  // the edition's SCAN_LIFECYCLE_HOOKS port; recordScanState hands the scan
  // over once, when every container is closed.
  describe('updateScanState — the lifecycle hooks', () => {
    const hookedScan = (statuses: string[]) =>
      ({
        id: 's-hooks',
        ...resultsFinal(),
        organizationId: 'o1',
        projectId: 'p1',
        state: 'running',
        containers: statuses.map((status, i) => ({
          id: `c${i}`,
          status,
          image: 'cybedefend-scanners/sast',
          podName: `p${i}`,
        })),
      }) as unknown as Scan;

    it('hands a scan whose containers all closed to the lifecycle hooks', async () => {
      const scan = hookedScan(['completed']);

      await manager.updateScanState(scan);

      expect(onScanClosed).toHaveBeenCalledWith(
        expect.objectContaining({ id: scan.id }),
        'completed',
        'containers',
      );
    });

    it('hands nothing to the hooks while a container is open', async () => {
      await manager.updateScanState(hookedScan(['completed', 'running']));

      expect(onScanClosed).not.toHaveBeenCalled();
    });
  });

  // The terminal state and SCAN_STATUS_CHANGED never wait for the archive
  // deletion and the issue creation, and a recompute neither reads the scan
  // again with its containers (DISTINCT pre-query + join) nor writes it with
  // a `save()` that reads it a third time.
  describe('updateScanState — the state first, the clean-up after', () => {
    const doneScan = (overrides: Record<string, unknown> = {}) =>
      ({
        id: 's-done',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'running',
        scanType: 'code',
        isDiffScan: false,
        containers: [
          {
            id: 'c1',
            status: 'completed',
            image: 'cybedefend-scanners/sast',
            podName: 'p1',
          },
          {
            id: 'c2',
            status: 'completed',
            image: 'cybedefend-scanners/sca',
            podName: 'p2',
          },
        ],
        ...overrides,
      }) as unknown as Scan;
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const statusEvents = () =>
      realtimePublish.mock.calls
        .map(([event]) => event)
        .filter((event) => event.type === 'SCAN_STATUS_CHANGED');
    // A scan whose containers all failed has no result to wait for: it is
    // never held, and its clean-up tells analysis-reporting it ended.
    const failedContainers = [
      {
        id: 'c1',
        status: 'failed',
        image: 'cybedefend-scanners/sast',
        podName: 'p1',
      },
      {
        id: 'c2',
        status: 'failed',
        image: 'cybedefend-scanners/sca',
        podName: 'p2',
      },
    ];

    it('writes the terminal state, endTime included, and publishes it while the archive deletion and the end-of-scan notice hang', async () => {
      deleteFile.mockReturnValue(new Promise(() => undefined));
      // Answered at the end of the test: a call left pending would keep
      // retrying (30 s per attempt) after the test, on real timers.
      const answer = new Subject<{ success: boolean; message: string }>();
      notifyScanEnded.mockReturnValue(answer);
      const scan = doneScan({ containers: failedContainers });

      void manager.updateScanState(scan);
      await flush();

      expect(writtenScan(scanRepo)).toEqual(
        expect.objectContaining({
          state: 'failed',
          endTime: expect.any(Date),
        }),
      );
      expect(statusEvents()).toHaveLength(1);
      expect(statusEvents()[0].payload.scanStatusChanged.currentState).toBe(
        'failed',
      );
      // The clean-up still runs, after the write.
      expect(deleteFile).toHaveBeenCalledWith('s-done');
      expect(
        scanRepo.stateUpdate.execute.mock.invocationCallOrder[0],
      ).toBeLessThan(deleteFile.mock.invocationCallOrder[0]);
      // analysis-reporting is told even while the
      // archive deletion hangs (a file-management that never answers).
      expect(notifyScanEnded).toHaveBeenCalledWith({
        scanId: 's-done',
        projectId: 'p1',
      });

      answer.next({ success: true, message: 'waiting' });
      answer.complete();
      await flush();
      expect(notifyScanEnded).toHaveBeenCalledTimes(1);
    });

    // analysis-reporting alone creates a scan's
    // issues, once its results are final. It learns here that every
    // container is closed, which it cannot see on its own when a scanner
    // failed after the others had finalized.
    it('tells analysis-reporting that the scan ended, without waiting, and never asks it for issues', async () => {
      const answer = new Subject<{ success: boolean; message: string }>();
      notifyScanEnded.mockReturnValue(answer);
      const scan = doneScan();

      let timer: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        manager.updateScanState(scan).then(() => 'returned'),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve('waiting'), 100);
        }),
      ]);
      clearTimeout(timer);

      expect(outcome).toBe('returned');
      expect(notifyScanEnded).toHaveBeenCalledWith({
        scanId: 's-done',
        projectId: 'p1',
      });
      expect(createIssuesForScan).not.toHaveBeenCalled();

      answer.next({ success: true, message: 'dispatched' });
      answer.complete();
      await flush();
      expect(notifyScanEnded).toHaveBeenCalledTimes(1);
    });

    // A diff scan with results is held and told at the hold
    // (scanStateManager.results-hold.spec.ts); one that ends without being
    // held is not told at its clean-up.
    it('tells nothing for a diff scan that ends without being held', async () => {
      await manager.updateScanState(
        doneScan({ isDiffScan: true, containers: failedContainers }),
      );
      await flush();

      expect(notifyScanEnded).not.toHaveBeenCalled();
      expect(createIssuesForScan).not.toHaveBeenCalled();
      expect(writtenScan(scanRepo)).toEqual(
        expect.objectContaining({ state: 'failed' }),
      );
      expect(deleteFile).toHaveBeenCalledWith('s-done');
    });

    describe('when analysis-reporting cannot be told at once', () => {
      // What a gRPC client call rejects with: a grpc-js ServiceError.
      const serviceError = (code: status, details: string) =>
        throwError(() =>
          Object.assign(new Error(`${code} ${details}`), { code, details }),
        );
      const unavailable = () =>
        serviceError(status.UNAVAILABLE, 'Scan end not evaluated');

      beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      });
      afterEach(() => {
        jest.useRealTimers();
      });

      it('retries until it is told', async () => {
        notifyScanEnded
          .mockReturnValueOnce(unavailable())
          .mockReturnValueOnce(unavailable());

        await manager.updateScanState(doneScan());
        await jest.advanceTimersByTimeAsync(20_000);

        expect(notifyScanEnded).toHaveBeenCalledTimes(3);
        expect(logger.error).not.toHaveBeenCalled();
        expect(createIssuesForScan).not.toHaveBeenCalled();
      });

      it('gives up after 4 attempts over about 14 s, and says so', async () => {
        notifyScanEnded.mockImplementation(unavailable);

        await manager.updateScanState(doneScan());
        await jest.advanceTimersByTimeAsync(13_000);
        expect(notifyScanEnded).toHaveBeenCalledTimes(3);
        await jest.advanceTimersByTimeAsync(60_000);

        expect(notifyScanEnded).toHaveBeenCalledTimes(4);
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('[ScanEnded]'),
        );
      });

      // A call that never answers (a half-open
      // connection) held the retries for good. Each attempt has 30 s, more
      // than a dispatch takes there; a retry of a dispatch still running
      // finds it already done.
      it('gives up an attempt that never answers after 30 s, and retries', async () => {
        notifyScanEnded.mockReturnValueOnce(NEVER);

        await manager.updateScanState(doneScan());
        await jest.advanceTimersByTimeAsync(29_000);
        expect(notifyScanEnded).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(3_000);

        expect(notifyScanEnded).toHaveBeenCalledTimes(2);
        expect(logger.error).not.toHaveBeenCalled();
      });

      it('does not retry a request analysis-reporting refused', async () => {
        notifyScanEnded.mockReturnValue(
          serviceError(status.INVALID_ARGUMENT, 'missing scanId or projectId'),
        );

        await manager.updateScanState(doneScan());
        await jest.advanceTimersByTimeAsync(20_000);

        expect(notifyScanEnded).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('[ScanEnded]'),
        );
      });

      // Deployed before analysis-reporting, security-scanning would lose the
      // issues of the scans only it sees ending: it falls back, once, to the
      // call it made before.
      it('falls back to CreateIssuesForScan when analysis-reporting predates NotifyScanEnded', async () => {
        notifyScanEnded.mockReturnValue(
          serviceError(
            status.UNIMPLEMENTED,
            'The server does not implement the method',
          ),
        );

        await manager.updateScanState(doneScan());
        await jest.advanceTimersByTimeAsync(20_000);

        expect(notifyScanEnded).toHaveBeenCalledTimes(1);
        expect(createIssuesForScan).toHaveBeenCalledTimes(1);
        expect(createIssuesForScan).toHaveBeenCalledWith({
          projectId: 'p1',
          scanId: 's-done',
          organizationId: 'o1',
        });
      });
    });

    it('reads the containers with one projected find, and writes the scan without findOne nor save', async () => {
      containerRepo.find.mockResolvedValue([
        {
          id: 'c1',
          status: 'running',
          image: 'cybedefend-scanners/sast',
          podName: 'p1',
        },
        {
          id: 'c2',
          status: 'completed',
          image: 'cybedefend-scanners/sca',
          podName: 'p2',
        },
      ]);
      const scan = {
        id: 's-tick',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'queued',
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(containerRepo.find).toHaveBeenCalledTimes(1);
      expect(containerRepo.find).toHaveBeenCalledWith({
        where: { scanId: 's-tick' },
        select: { id: true, status: true, image: true, podName: true },
      });
      expect(scanRepo.findOne).not.toHaveBeenCalled();
      expect(scanRepo.save).not.toHaveBeenCalled();
      expect(writtenScan(scanRepo)).toEqual(
        expect.objectContaining({ state: 'running' }),
      );
      // The caller's slot check reads these containers.
      expect(scan.containers).toHaveLength(2);
    });

    it('never rewrites a scan cancelled meanwhile', async () => {
      scanRepo.stateUpdate.execute.mockResolvedValue({ affected: 0 });
      const scan = doneScan({ containers: failedContainers });

      await manager.updateScanState(scan);
      await flush();

      const where = [
        ...scanRepo.stateUpdate.where.mock.calls,
        ...scanRepo.stateUpdate.andWhere.mock.calls,
      ];
      expect(where).toEqual(
        expect.arrayContaining([
          ['id = :id', { id: 's-done' }],
          ['state <> :cancelled', { cancelled: 'cancelled' }],
        ]),
      );
      // Not written: nothing to publish, nothing to clean up.
      expect(statusEvents()).toHaveLength(0);
      expect(deleteFile).not.toHaveBeenCalled();
      expect(notifyScanEnded).not.toHaveBeenCalled();
    });

    it('writes nothing when the recompute changes nothing', async () => {
      const scan = {
        id: 's-same',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'running',
        errorMessage: null,
        errorCode: null,
        errorCategory: null,
        containers: [
          {
            id: 'c1',
            status: 'running',
            image: 'cybedefend-scanners/sast',
            podName: 'p1',
          },
        ],
      } as unknown as Scan;

      await manager.updateScanState(scan);

      expect(scanRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(statusEvents()).toHaveLength(0);
    });
  });

  // ScanService retires scans that never went through a
  // container (a stalled queue, an UpdateScan with no pod). It publishes
  // through THIS method so there is exactly one SCAN_STATUS_CHANGED emitter.
  describe('publishStatusChanged', () => {
    it('publishes the standard payload, with the reason, for a cancellation', () => {
      const scan: any = {
        id: 's-q',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'cancelled',
        errorCode: 65,
        errorCategory: 'infra',
        errorMessage: 'waited too long for a free scan slot',
      };

      manager.publishStatusChanged(scan, 'queued');

      expect(realtimePublish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SCAN_STATUS_CHANGED',
          scope: { organizationId: 'o1', projectId: 'p1', scanId: 's-q' },
          payload: {
            scanStatusChanged: {
              scanId: 's-q',
              previousState: 'queued',
              currentState: 'cancelled',
              errorCode: 65,
              errorCategory: 'infra',
              errorMessage: 'waited too long for a free scan slot',
            },
          },
        }),
        expect.objectContaining({
          dedupeKey: 'scan:s-q:state:cancelled',
          dedupeTtlSec: expect.any(Number),
        }),
      );
    });

    it('does not publish when the state did not actually change', () => {
      const scan: any = {
        id: 's-same',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'failed',
      };

      manager.publishStatusChanged(scan, 'failed');

      expect(realtimePublish).not.toHaveBeenCalled();
    });

    it('omits the error fields for a non-failure transition', () => {
      const scan: any = {
        id: 's-ok',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'running',
        errorCode: 500,
        errorCategory: 'stale',
        errorMessage: 'stale',
      };

      manager.publishStatusChanged(scan, 'queued');

      const payload =
        realtimePublish.mock.calls[0][0].payload.scanStatusChanged;
      expect(payload).not.toHaveProperty('errorCode');
      expect(payload).not.toHaveProperty('errorCategory');
      expect(payload).not.toHaveProperty('errorMessage');
    });

    // A diff scan is shown by no page that listens to the event.
    // The home list, the org overview and the Results pages read full scans
    // only (getProjectsScanStatus, getBatchLastScans and getLastScanStatus
    // exclude diff scans), and the diff-scan history panel polls. Each
    // transition still made every open home page reload its list and KPI cards.
    it('publishes nothing for a diff scan', () => {
      const scan: any = {
        id: 's-diff',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'completed',
        isDiffScan: true,
      };

      manager.publishStatusChanged(scan, 'running');

      expect(realtimePublish).not.toHaveBeenCalled();
    });

    it('still saves a diff scan state recomputed from its containers, without publishing it', async () => {
      const scan: any = {
        id: 's-diff',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'queued',
        isDiffScan: true,
        containers: [{ status: 'running', image: 'sast', podName: '' }],
      };

      await manager.updateScanState(scan);

      expect(scan.state).toBe('running');
      // Written by the one conditional UPDATE.
      expect(writtenScan(scanRepo)).toEqual(
        expect.objectContaining({ state: 'running' }),
      );
      expect(scanRepo.stateUpdate.where).toHaveBeenCalledWith('id = :id', {
        id: 's-diff',
      });
      // The UPDATE is sent, once: building it is not writing it.
      expect(scanRepo.stateUpdate.execute).toHaveBeenCalledTimes(1);
      expect(realtimePublish).not.toHaveBeenCalled();
    });
  });

  // A graph-only scan (a repository import) holds only its agent container.
  // It runs until the agent closes it once the parse is over, then ends
  // through handleCompletedScan: the archive goes only then. Such a scan has
  // no finding, so neither issue creation nor a policy evaluation is asked
  // for.
  describe('graph-only scans', () => {
    const graphOnly = (agentStatus: string) =>
      ({
        id: 'g1',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'running',
        isGraphOnly: 1,
        scanType: 'sast,sca',
        containers: [
          {
            id: 'a1',
            status: agentStatus,
            image: 'agent-service',
            podName: 'scan-pod-agent-graph-1',
          },
        ],
      }) as unknown as Scan;
    let deleteFile: jest.Mock;
    let createIssuesForScan: jest.Mock;
    let triggerEvaluation: jest.Mock;

    beforeEach(() => {
      deleteFile = (module.get(FileManagementService) as any).deleteFile;
      createIssuesForScan = jest.fn(() => of({ success: true }));
      triggerEvaluation = jest.fn(() => of({ evaluationId: 'e1' }));
      (manager as any).resultServiceClient = {
        createIssuesForScan,
        notifyScanEnded,
      };
      (manager as any).policyEvaluationClient = { triggerEvaluation };
    });

    it('stays running, archive kept, while the agent parses', async () => {
      const scan = graphOnly('running');

      await manager.updateScanState(scan);

      expect(scan.state).toBe('running');
      expect(deleteFile).not.toHaveBeenCalled();
    });

    it('completes and deletes its archive once the agent closes completed', async () => {
      const scan = graphOnly('completed');

      await manager.updateScanState(scan);

      expect(scan.state).toBe('completed');
      expect(scan.endTime).toBeInstanceOf(Date);
      expect(deleteFile).toHaveBeenCalledWith('g1');
    });

    it('fails, archive deleted, when the agent closes failed', async () => {
      const scan = graphOnly('failed');

      await manager.updateScanState(scan);

      expect(scan.state).toBe('failed');
      expect(deleteFile).toHaveBeenCalledWith('g1');
    });

    // analysis-reporting creates a scan's issues once told
    // the scan ended (NotifyScanEnded): a graph-only scan is not told.
    it('tells analysis-reporting nothing and asks for no policy evaluation', async () => {
      await manager.updateScanState(graphOnly('completed'));
      await new Promise((r) => setImmediate(r));

      expect(notifyScanEnded).not.toHaveBeenCalled();
      expect(createIssuesForScan).not.toHaveBeenCalled();
      expect(triggerEvaluation).not.toHaveBeenCalled();
    });

    // A full scan whose results are not final is held, and told at its hold
    // (scanStateManager.results-hold.spec.ts); one with no result (its only
    // container failed) is told at its clean-up.
    it('a full scan still tells analysis-reporting it ended and asks for its policies', async () => {
      const scan = {
        ...graphOnly('failed'),
        isGraphOnly: 0,
      } as unknown as Scan;

      await manager.updateScanState(scan);
      await new Promise((r) => setImmediate(r));

      expect(notifyScanEnded).toHaveBeenCalledTimes(1);
      expect(createIssuesForScan).not.toHaveBeenCalled();
      expect(triggerEvaluation).toHaveBeenCalledTimes(1);
    });
  });

  // An import scan (`importFormat` set) has no archive record — its
  // uploaded object lives under `import/<projectId>/<scanId>.sarif` and is
  // deleted by ImportScanService at every terminal move — so the
  // scan-end clean-up never calls deleteFile(scan.id) for one. A code scan
  // still does (the tests above).
  describe('import scans', () => {
    it('deletes no scan archive at the end of an import scan', async () => {
      const scan = {
        id: 's-import',
        organizationId: 'o1',
        projectId: 'p1',
        state: 'completed',
        scanType: 'sast',
        importFormat: 'sarif',
        containers: [],
      } as unknown as Scan;

      await manager.handleCompletedScan(scan);
      await new Promise((r) => setImmediate(r));

      expect(deleteFile).not.toHaveBeenCalled();
      // The end-of-scan notice and the policy evaluation still run.
      expect(notifyScanEnded).toHaveBeenCalledWith({
        scanId: 's-import',
        projectId: 'p1',
      });
    });
  });
});
