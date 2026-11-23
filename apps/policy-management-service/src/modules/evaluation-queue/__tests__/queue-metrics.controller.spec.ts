import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { QueueMetricsController } from '../queue-metrics.controller';
import { QueueMetricsAuthGuard } from '../queue-metrics-auth.guard';
import { EvaluationQueueService } from '../evaluation-queue.service';
import { QueueBacklogResponse } from '../queue-metrics.types';

/**
 * TDD spec for QueueMetricsController + QueueMetricsAuthGuard.
 *
 * Controller tests: verify endpoint delegates to EvaluationQueueService.getQueueBacklog().
 * Guard tests: verify token-based access control behaviour.
 */

const mockBacklog: QueueBacklogResponse = {
  queues: {
    policyEvaluation: {
      waiting: 4,
      prioritized: 1,
      delayed: 2,
      active: 3,
      pending: 7,
      backlog: 10,
    },
  },
};

const mockEvaluationQueueService = {
  getQueueBacklog: jest.fn().mockResolvedValue(mockBacklog),
};

describe('QueueMetricsController', () => {
  let controller: QueueMetricsController;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [QueueMetricsController],
      providers: [
        {
          provide: EvaluationQueueService,
          useValue: mockEvaluationQueueService,
        },
        QueueMetricsAuthGuard,
      ],
    }).compile();

    controller = moduleRef.get(QueueMetricsController);
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.QUEUE_METRICS_TOKEN;
  });

  it('getQueueMetrics delegates to EvaluationQueueService.getQueueBacklog()', async () => {
    mockEvaluationQueueService.getQueueBacklog.mockResolvedValueOnce(
      mockBacklog,
    );
    const result = await controller.getQueueMetrics();
    expect(mockEvaluationQueueService.getQueueBacklog).toHaveBeenCalledTimes(1);
    expect(result).toBe(mockBacklog);
  });

  it('returns a result with the { queues: { policyEvaluation } } shape', async () => {
    mockEvaluationQueueService.getQueueBacklog.mockResolvedValueOnce(
      mockBacklog,
    );
    const result = await controller.getQueueMetrics();
    expect(result).toHaveProperty('queues');
    expect(result.queues).toHaveProperty('policyEvaluation');
    expect(result.queues.policyEvaluation.pending).toBe(7);
    expect(result.queues.policyEvaluation.backlog).toBe(10);
  });
});

describe('QueueMetricsAuthGuard', () => {
  let guard: QueueMetricsAuthGuard;

  beforeEach(() => {
    guard = new QueueMetricsAuthGuard();
  });

  afterEach(() => {
    delete process.env.QUEUE_METRICS_TOKEN;
  });

  function makeContext(authHeader?: string): ExecutionContext {
    const request = {
      headers: authHeader ? { authorization: authHeader } : {},
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  describe('when QUEUE_METRICS_TOKEN is not set', () => {
    it('allows any request without auth header', () => {
      delete process.env.QUEUE_METRICS_TOKEN;
      expect(guard.canActivate(makeContext())).toBe(true);
    });

    it('allows a request even with a Bearer header present', () => {
      delete process.env.QUEUE_METRICS_TOKEN;
      expect(guard.canActivate(makeContext('Bearer any-token'))).toBe(true);
    });
  });

  describe('when QUEUE_METRICS_TOKEN is set', () => {
    const TOKEN = 'super-secret-keda-token';

    beforeEach(() => {
      process.env.QUEUE_METRICS_TOKEN = TOKEN;
    });

    it('throws UnauthorizedException when Authorization header is absent', () => {
      expect(() => guard.canActivate(makeContext())).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when Authorization header has wrong token', () => {
      expect(() =>
        guard.canActivate(makeContext('Bearer wrong-token')),
      ).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when header is missing Bearer prefix', () => {
      expect(() => guard.canActivate(makeContext(TOKEN))).toThrow(
        UnauthorizedException,
      );
    });

    it('returns true when Bearer token matches QUEUE_METRICS_TOKEN', () => {
      expect(guard.canActivate(makeContext(`Bearer ${TOKEN}`))).toBe(true);
    });
  });
});
