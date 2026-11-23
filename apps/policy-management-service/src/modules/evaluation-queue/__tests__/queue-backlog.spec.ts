import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EvaluationQueueService } from '../evaluation-queue.service';
import { POLICY_QUEUE_NAMES } from '../queue-names';

/**
 * TDD spec for EvaluationQueueService.getQueueBacklog()
 *
 * Covers:
 * - Per-queue field computation: waiting = wait, pending = waiting+prioritized+delayed, backlog = pending+active
 * - The single policyEvaluation queue is included in the result
 * - No aggregates block (only one queue, unlike analysis-reporting)
 */
describe('EvaluationQueueService.getQueueBacklog', () => {
  let service: EvaluationQueueService;

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

  let evaluationMock: ReturnType<typeof makeQueueMock>;

  beforeEach(async () => {
    evaluationMock = makeQueueMock({
      wait: 4,
      prioritized: 1,
      delayed: 2,
      active: 3,
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationQueueService,
        {
          provide: getQueueToken(POLICY_QUEUE_NAMES.EVALUATION),
          useValue: evaluationMock,
        },
      ],
    }).compile();

    service = moduleRef.get(EvaluationQueueService);
  });

  it('calls getJobCounts on the evaluation queue with the correct state keys', async () => {
    await service.getQueueBacklog();

    expect(evaluationMock.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
  });

  it('maps BullMQ wait key to waiting in the output', async () => {
    const result = await service.getQueueBacklog();
    // evaluationMock: wait=4 → waiting=4
    expect(result.queues.policyEvaluation.waiting).toBe(4);
  });

  it('computes pending = waiting + prioritized + delayed', async () => {
    const result = await service.getQueueBacklog();
    // wait=4, prioritized=1, delayed=2 → pending=7
    expect(result.queues.policyEvaluation.pending).toBe(7);
  });

  it('computes backlog = pending + active', async () => {
    const result = await service.getQueueBacklog();
    // pending=7, active=3 → backlog=10
    expect(result.queues.policyEvaluation.backlog).toBe(10);
  });

  it('returns the correct { queues: { policyEvaluation } } shape', async () => {
    const result = await service.getQueueBacklog();
    expect(result).toHaveProperty('queues');
    expect(result.queues).toHaveProperty('policyEvaluation');
    expect(Object.keys(result.queues)).toEqual(['policyEvaluation']);
  });

  it('does NOT include an aggregates block', async () => {
    const result = await service.getQueueBacklog();
    expect(result).not.toHaveProperty('aggregates');
  });

  it('returns integer zero values (not undefined) when queue is empty', async () => {
    evaluationMock.getJobCounts.mockResolvedValueOnce({
      wait: 0,
      prioritized: 0,
      delayed: 0,
      active: 0,
    });
    const result = await service.getQueueBacklog();
    expect(result.queues.policyEvaluation.waiting).toBe(0);
    expect(result.queues.policyEvaluation.prioritized).toBe(0);
    expect(result.queues.policyEvaluation.delayed).toBe(0);
    expect(result.queues.policyEvaluation.active).toBe(0);
    expect(result.queues.policyEvaluation.pending).toBe(0);
    expect(result.queues.policyEvaluation.backlog).toBe(0);
  });
});
