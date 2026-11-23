import { Test, TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ScanQueueService } from '../scan-queue.service';
import { QUEUE_NAMES } from '../queue-names';
import {
  QUEUE_BACKLOG_EXTENSIONS,
  QueueBacklogExtension,
} from '../../../edition/ports/queue-backlog-extensions.port';

/**
 * TDD spec for ScanQueueService.getQueueBacklog()
 *
 * Covers:
 * - Per-queue field computation: waiting = wait, pending = waiting+prioritized+delayed, backlog = pending+active
 * - All 10 queues are included in the result
 * - aggregates.workerPending = sum of pending for all queues EXCEPT scaAutofix
 * - aggregates.autofixPending = scaAutofix.pending
 *
 * The AI-BOM queue left ScanQueueService; in the cloud it comes back
 * as a QUEUE_BACKLOG_EXTENSIONS entry (EeQueuesModule, pinned by
 * a closed spec). The agent-reanalysis
 * queue left too and comes back the same way, and so does the SCA autofix
 * queue. This spec supplies the three entries inline, so the 10
 * keys and both aggregates are asserted as before.
 */
describe('ScanQueueService.getQueueBacklog', () => {
  let service: ScanQueueService;

  /**
   * Build a minimal BullMQ Queue mock that returns given counts.
   * The mock only implements getJobCounts (used by getQueueBacklog).
   */
  function makeQueueMock(counts: {
    wait: number;
    prioritized: number;
    delayed: number;
    active: number;
  }): { getJobCounts: jest.Mock; client: Promise<unknown> } {
    return {
      getJobCounts: jest.fn().mockResolvedValue(counts),
      client: Promise.resolve({ duplicate: () => ({}) }),
    };
  }

  let scaMock: ReturnType<typeof makeQueueMock>;
  let sastIacMock: ReturnType<typeof makeQueueMock>;
  let containerMock: ReturnType<typeof makeQueueMock>;
  let aibomMock: ReturnType<typeof makeQueueMock>;
  let scaAutoFixMock: ReturnType<typeof makeQueueMock>;
  let cvssRecalcMock: ReturnType<typeof makeQueueMock>;
  let agentReanalysisMock: ReturnType<typeof makeQueueMock>;
  let cyberiskRecomputeMock: ReturnType<typeof makeQueueMock>;
  let reportsMock: ReturnType<typeof makeQueueMock>;
  let aggregatedReportsMock: ReturnType<typeof makeQueueMock>;
  let resultsImportMock: ReturnType<typeof makeQueueMock>;

  function queueProviders(): Provider[] {
    return [
      { provide: getQueueToken(QUEUE_NAMES.SCA), useValue: scaMock },
      { provide: getQueueToken(QUEUE_NAMES.SAST_IAC), useValue: sastIacMock },
      {
        provide: getQueueToken(QUEUE_NAMES.CONTAINER),
        useValue: containerMock,
      },
      {
        provide: getQueueToken(QUEUE_NAMES.CVSS_RECALCULATION),
        useValue: cvssRecalcMock,
      },
      {
        provide: getQueueToken(QUEUE_NAMES.CYBERISK_RECOMPUTE),
        useValue: cyberiskRecomputeMock,
      },
      { provide: getQueueToken(QUEUE_NAMES.REPORTS), useValue: reportsMock },
      {
        provide: getQueueToken(QUEUE_NAMES.AGGREGATED_REPORTS),
        useValue: aggregatedReportsMock,
      },
      {
        provide: getQueueToken(QUEUE_NAMES.VULN_BATCH_UPDATE),
        useValue: makeQueueMock({
          wait: 0,
          prioritized: 0,
          delayed: 0,
          active: 0,
        }),
      },
      {
        provide: getQueueToken(QUEUE_NAMES.RESULTS_IMPORT),
        useValue: resultsImportMock,
      },
    ];
  }

  /** The cloud's AI-BOM entry, as EeQueuesModule supplies it. */
  function aibomExtension(): QueueBacklogExtension {
    return { key: 'aibom', queue: aibomMock, aggregate: 'workerPending' };
  }

  /** The cloud's agent-reanalysis entry, as EeQueuesModule supplies it. */
  function agentReanalysisExtension(): QueueBacklogExtension {
    return {
      key: 'agentReanalysis',
      queue: agentReanalysisMock,
      aggregate: 'workerPending',
    };
  }

  /** The cloud's SCA autofix entry, as EeQueuesModule supplies it. */
  function scaAutofixExtension(): QueueBacklogExtension {
    return {
      key: 'scaAutofix',
      queue: scaAutoFixMock,
      aggregate: 'autofixPending',
    };
  }

  async function buildService(
    extraProviders: Provider[] = [
      {
        provide: QUEUE_BACKLOG_EXTENSIONS,
        useValue: [
          aibomExtension(),
          agentReanalysisExtension(),
          scaAutofixExtension(),
        ],
      },
    ],
  ): Promise<ScanQueueService> {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ScanQueueService, ...queueProviders(), ...extraProviders],
    }).compile();
    return moduleRef.get(ScanQueueService);
  }

  beforeEach(async () => {
    scaMock = makeQueueMock({ wait: 3, prioritized: 1, delayed: 2, active: 1 });
    sastIacMock = makeQueueMock({
      wait: 5,
      prioritized: 0,
      delayed: 1,
      active: 2,
    });
    containerMock = makeQueueMock({
      wait: 0,
      prioritized: 0,
      delayed: 0,
      active: 0,
    });
    aibomMock = makeQueueMock({
      wait: 1,
      prioritized: 0,
      delayed: 0,
      active: 1,
    });
    scaAutoFixMock = makeQueueMock({
      wait: 4,
      prioritized: 2,
      delayed: 1,
      active: 3,
    });
    cvssRecalcMock = makeQueueMock({
      wait: 2,
      prioritized: 0,
      delayed: 0,
      active: 1,
    });
    agentReanalysisMock = makeQueueMock({
      wait: 1,
      prioritized: 0,
      delayed: 1,
      active: 0,
    });
    cyberiskRecomputeMock = makeQueueMock({
      wait: 3,
      prioritized: 1,
      delayed: 0,
      active: 2,
    });
    reportsMock = makeQueueMock({
      wait: 0,
      prioritized: 0,
      delayed: 2,
      active: 1,
    });
    aggregatedReportsMock = makeQueueMock({
      wait: 1,
      prioritized: 0,
      delayed: 0,
      active: 0,
    });
    // Idle by default, so the cloud totals below are unchanged.
    resultsImportMock = makeQueueMock({
      wait: 0,
      prioritized: 0,
      delayed: 0,
      active: 0,
    });

    service = await buildService();
  });

  it('calls getJobCounts on all 10 queues concurrently', async () => {
    await service.getQueueBacklog();

    expect(scaMock.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
    expect(sastIacMock.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
    expect(containerMock.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
    expect(aibomMock.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
    expect(scaAutoFixMock.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
    expect(cvssRecalcMock.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
    expect(agentReanalysisMock.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
    expect(cyberiskRecomputeMock.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
    expect(reportsMock.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
    expect(aggregatedReportsMock.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
  });

  it('maps BullMQ wait key to waiting in the output', async () => {
    const result = await service.getQueueBacklog();
    // scaMock: wait=3 → waiting=3
    expect(result.queues.sca.waiting).toBe(3);
  });

  it('computes pending = waiting + prioritized + delayed', async () => {
    const result = await service.getQueueBacklog();
    // sca: waiting=3, prioritized=1, delayed=2 → pending=6
    expect(result.queues.sca.pending).toBe(6);
    // sastIac: waiting=5, prioritized=0, delayed=1 → pending=6
    expect(result.queues.sastIac.pending).toBe(6);
    // container: all zeros → pending=0
    expect(result.queues.container.pending).toBe(0);
  });

  it('computes backlog = pending + active', async () => {
    const result = await service.getQueueBacklog();
    // sca: pending=6, active=1 → backlog=7
    expect(result.queues.sca.backlog).toBe(7);
    // aibom: waiting=1, prioritized=0, delayed=0, active=1 → pending=1, backlog=2
    expect(result.queues.aibom.pending).toBe(1);
    expect(result.queues.aibom.backlog).toBe(2);
  });

  it('includes all 11 queue keys', async () => {
    const result = await service.getQueueBacklog();
    // Exhaustive on purpose: a queue silently missing from this payload is a
    // queue KEDA can never scale on.
    expect(Object.keys(result.queues).sort()).toEqual(
      [
        'agentReanalysis',
        'aggregatedReports',
        'aibom',
        'container',
        'cvss',
        'cyberisk',
        'reports',
        'resultsImport',
        'sastIac',
        'sca',
        'scaAutofix',
      ].sort(),
    );
  });

  it('computes aggregates.workerPending = sum of pending for all queues except scaAutofix', async () => {
    const result = await service.getQueueBacklog();
    // sca pending=6, sastIac=6, container=0, aibom=1, cvss=2, agentReanalysis=2, cyberisk=4, reports=2, aggregatedReports=1
    // scaAutofix excluded
    const expected =
      result.queues.sca.pending +
      result.queues.sastIac.pending +
      result.queues.container.pending +
      result.queues.aibom.pending +
      result.queues.cvss.pending +
      result.queues.agentReanalysis.pending +
      result.queues.cyberisk.pending +
      result.queues.reports.pending +
      result.queues.aggregatedReports.pending;
    expect(result.aggregates.workerPending).toBe(expected);
    // Does NOT include scaAutofix.pending
    expect(result.aggregates.workerPending).not.toBe(
      expected + result.queues.scaAutofix.pending,
    );
  });

  it('computes aggregates.autofixPending = scaAutofix.pending', async () => {
    const result = await service.getQueueBacklog();
    // scaAutofix: waiting=4, prioritized=2, delayed=1, active=3 → pending=7
    expect(result.queues.scaAutofix.pending).toBe(7);
    expect(result.aggregates.autofixPending).toBe(
      result.queues.scaAutofix.pending,
    );
  });

  it('the cloud backlog keeps every key KEDA reads', async () => {
    // The three closed queues (aibom, agentReanalysis, scaAutofix)
    // all come from QUEUE_BACKLOG_EXTENSIONS, as EeQueuesModule supplies
    // them in the cloud; the core service no longer reads any of them.
    const result = await service.getQueueBacklog();
    expect(Object.keys(result.queues)).toEqual([
      'sca',
      'sastIac',
      'container',
      'cvss',
      'cyberisk',
      'reports',
      'aggregatedReports',
      'resultsImport',
      'aibom',
      'agentReanalysis',
      'scaAutofix',
    ]);
    expect(result.queues.scaAutofix.pending).toBe(7);
    expect(result.aggregates.autofixPending).toBe(7);
    expect(result.aggregates.workerPending).toBe(
      6 + 6 + 0 + 2 + 4 + 2 + 1 + 1 + 2,
    );
    expect(scaAutoFixMock.getJobCounts).toHaveBeenCalledTimes(1);
  });

  it('reports resultsImport in workerPending', async () => {
    // The results-import queue is a core queue of the worker.
    const base = await service.getQueueBacklog();
    resultsImportMock = makeQueueMock({
      wait: 2,
      prioritized: 1,
      delayed: 0,
      active: 1,
    });
    const withImports = await (await buildService()).getQueueBacklog();

    expect(withImports.queues.resultsImport).toEqual({
      waiting: 2,
      prioritized: 1,
      delayed: 0,
      active: 1,
      pending: 3,
      backlog: 4,
    });
    expect(withImports.aggregates.workerPending).toBe(
      base.aggregates.workerPending + 3,
    );
    expect(withImports.aggregates.autofixPending).toBe(
      base.aggregates.autofixPending,
    );
  });

  it('returns integer zero values (not undefined) when queue is empty', async () => {
    const result = await service.getQueueBacklog();
    expect(result.queues.container.waiting).toBe(0);
    expect(result.queues.container.prioritized).toBe(0);
    expect(result.queues.container.delayed).toBe(0);
    expect(result.queues.container.active).toBe(0);
    expect(result.queues.container.pending).toBe(0);
    expect(result.queues.container.backlog).toBe(0);
  });

  describe('with QUEUE_BACKLOG_EXTENSIONS', () => {
    /** A queue mock whose getJobCounts answers the given `wait` count. */
    function counts(c: { wait: number }): Pick<Queue, 'getJobCounts'> {
      return {
        getJobCounts: jest.fn().mockResolvedValue({
          wait: c.wait,
          prioritized: 0,
          delayed: 0,
          active: 0,
        }),
      } as unknown as Pick<Queue, 'getJobCounts'>;
    }

    it('an extension queue is reported under its key and counted in its aggregate', async () => {
      const extensions: QueueBacklogExtension[] = [
        aibomExtension(),
        agentReanalysisExtension(),
        scaAutofixExtension(),
        {
          key: 'extra',
          aggregate: 'workerPending',
          queue: counts({ wait: 2 }),
        },
        {
          key: 'extraAutofix',
          aggregate: 'autofixPending',
          queue: counts({ wait: 3 }),
        },
      ];
      const extService = await buildService([
        { provide: QUEUE_BACKLOG_EXTENSIONS, useValue: extensions },
      ]);

      const base = await service.getQueueBacklog();
      const withExt = await extService.getQueueBacklog();

      // Reported under its key.
      expect(withExt.queues.extra.pending).toBe(2);
      expect(withExt.queues.extraAutofix.pending).toBe(3);
      // Counted in its aggregate: +2 workerPending, +3 autofixPending.
      expect(withExt.aggregates.workerPending).toBe(
        base.aggregates.workerPending + 2,
      );
      expect(withExt.aggregates.autofixPending).toBe(
        base.aggregates.autofixPending + 3,
      );
      // The autofixPending extension adds 0 to workerPending.
      expect(withExt.aggregates.workerPending).toBe(
        base.aggregates.workerPending + 2,
      );
      // The base keys are unchanged, the extensions appended after them.
      expect(Object.keys(withExt.queues)).toEqual([
        ...Object.keys(base.queues),
        'extra',
        'extraAutofix',
      ]);
    });
  });
});
