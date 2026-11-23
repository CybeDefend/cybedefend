import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { QueueMetricsController } from '../queue-metrics.controller';
import { QueueMetricsAuthGuard } from '../queue-metrics-auth.guard';
import { ScanQueueService } from '../scan-queue.service';
import { ExecutionContext } from '@nestjs/common';

/**
 * TDD spec for QueueMetricsController + QueueMetricsAuthGuard.
 *
 * Controller tests: verify endpoint delegates to ScanQueueService.getQueueBacklog().
 * Guard tests: verify token-based access control behaviour.
 */

const mockBacklog = {
  queues: {
    sca: {
      waiting: 1,
      prioritized: 0,
      delayed: 0,
      active: 1,
      pending: 1,
      backlog: 2,
    },
    sastIac: {
      waiting: 0,
      prioritized: 0,
      delayed: 0,
      active: 0,
      pending: 0,
      backlog: 0,
    },
    container: {
      waiting: 0,
      prioritized: 0,
      delayed: 0,
      active: 0,
      pending: 0,
      backlog: 0,
    },
    aibom: {
      waiting: 0,
      prioritized: 0,
      delayed: 0,
      active: 0,
      pending: 0,
      backlog: 0,
    },
    cvss: {
      waiting: 0,
      prioritized: 0,
      delayed: 0,
      active: 0,
      pending: 0,
      backlog: 0,
    },
    agentReanalysis: {
      waiting: 0,
      prioritized: 0,
      delayed: 0,
      active: 0,
      pending: 0,
      backlog: 0,
    },
    cyberisk: {
      waiting: 0,
      prioritized: 0,
      delayed: 0,
      active: 0,
      pending: 0,
      backlog: 0,
    },
    reports: {
      waiting: 0,
      prioritized: 0,
      delayed: 0,
      active: 0,
      pending: 0,
      backlog: 0,
    },
    aggregatedReports: {
      waiting: 0,
      prioritized: 0,
      delayed: 0,
      active: 0,
      pending: 0,
      backlog: 0,
    },
    scaAutofix: {
      waiting: 2,
      prioritized: 0,
      delayed: 0,
      active: 0,
      pending: 2,
      backlog: 2,
    },
  },
  aggregates: { workerPending: 1, autofixPending: 2 },
};

const mockScanQueueService = {
  getQueueBacklog: jest.fn().mockResolvedValue(mockBacklog),
};

describe('QueueMetricsController', () => {
  let controller: QueueMetricsController;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [QueueMetricsController],
      providers: [
        { provide: ScanQueueService, useValue: mockScanQueueService },
        QueueMetricsAuthGuard,
      ],
    }).compile();

    controller = moduleRef.get(QueueMetricsController);
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.QUEUE_METRICS_TOKEN;
  });

  it('getQueueMetrics delegates to ScanQueueService.getQueueBacklog()', async () => {
    const result = await controller.getQueueMetrics();
    expect(mockScanQueueService.getQueueBacklog).toHaveBeenCalledTimes(1);
    expect(result).toBe(mockBacklog);
  });

  it('returns a result with queues and aggregates shape', async () => {
    const result = await controller.getQueueMetrics();
    expect(result).toHaveProperty('queues');
    expect(result).toHaveProperty('aggregates');
    expect(result.aggregates).toEqual({ workerPending: 1, autofixPending: 2 });
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
