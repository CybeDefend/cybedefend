/**
 * Hermetic HTTP integration test for the queue-metrics endpoint.
 *
 * Boots a minimal NestJS HTTP app (no real EvaluationQueueModule — no Redis/BullMQ)
 * that wires just QueueMetricsController + QueueMetricsAuthGuard + a mock
 * EvaluationQueueService. Makes real HTTP requests via Node's built-in `http`
 * module to assert the controller is reachable over the wire, the guard enforces
 * token-based auth, and the response JSON has the expected shape.
 *
 * This validates the HTTP serving path without any heavy infrastructure.
 */

import * as http from 'http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { QueueMetricsController } from '../queue-metrics.controller';
import { QueueMetricsAuthGuard } from '../queue-metrics-auth.guard';
import { EvaluationQueueService } from '../evaluation-queue.service';
import { QueueBacklogResponse } from '../queue-metrics.types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// HTTP helper: make a raw HTTP request and collect the response
// ---------------------------------------------------------------------------
interface HttpResponse {
  statusCode: number;
  body: string;
}

function httpGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'GET',
      headers,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('QueueMetrics HTTP integration', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QueueMetricsController],
      providers: [
        QueueMetricsAuthGuard,
        {
          provide: EvaluationQueueService,
          useValue: mockEvaluationQueueService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Listen on a random OS-assigned port to avoid collisions
    await app.listen(0);

    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port =
      address && typeof address === 'object' ? address.port : undefined;
    if (!port) {
      throw new Error('Could not determine listening port');
    }
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.QUEUE_METRICS_TOKEN;
  });

  afterEach(() => {
    delete process.env.QUEUE_METRICS_TOKEN;
  });

  describe('without QUEUE_METRICS_TOKEN configured', () => {
    it('GET /internal/queue-metrics returns 200 with backlog JSON', async () => {
      mockEvaluationQueueService.getQueueBacklog.mockResolvedValueOnce(
        mockBacklog,
      );

      const res = await httpGet(`${baseUrl}/internal/queue-metrics`);

      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as QueueBacklogResponse;
      expect(parsed).toHaveProperty('queues');
      expect(parsed.queues.policyEvaluation.pending).toBe(7);
      expect(parsed.queues.policyEvaluation.backlog).toBe(10);
    });

    it('GET /internal/queue-metrics allows requests with no Authorization header', async () => {
      const res = await httpGet(`${baseUrl}/internal/queue-metrics`);
      expect(res.statusCode).toBe(200);
    });

    it('GET /internal/queue-metrics allows requests even with a Bearer header present', async () => {
      const res = await httpGet(`${baseUrl}/internal/queue-metrics`, {
        Authorization: 'Bearer any-random-token',
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('with QUEUE_METRICS_TOKEN configured', () => {
    const TOKEN = 'keda-secret-abc123';

    beforeEach(() => {
      process.env.QUEUE_METRICS_TOKEN = TOKEN;
    });

    it('returns 401 when Authorization header is absent', async () => {
      const res = await httpGet(`${baseUrl}/internal/queue-metrics`);
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when Bearer token does not match', async () => {
      const res = await httpGet(`${baseUrl}/internal/queue-metrics`, {
        Authorization: 'Bearer wrong-token',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when Authorization header has no Bearer prefix', async () => {
      const res = await httpGet(`${baseUrl}/internal/queue-metrics`, {
        Authorization: TOKEN,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 when correct Bearer token is provided', async () => {
      const res = await httpGet(`${baseUrl}/internal/queue-metrics`, {
        Authorization: `Bearer ${TOKEN}`,
      });
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as QueueBacklogResponse;
      expect(parsed).toHaveProperty('queues');
      expect(parsed.queues).toHaveProperty('policyEvaluation');
    });
  });
});
