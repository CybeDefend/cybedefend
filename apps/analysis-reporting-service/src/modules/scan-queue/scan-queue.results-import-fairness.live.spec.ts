import { randomUUID } from 'node:crypto';
import { status } from '@grpc/grpc-js';
import { Job, Queue, Worker } from 'bullmq';
import { QUEUE_NAMES } from './queue-names';
import {
  DEFAULT_MAX_WAITING_IMPORTS_PER_ORG,
  ResultsImportJobData,
  ScanQueueService,
} from './scan-queue.service';

/**
 * LIVE spec on a real Redis: the results-import queue is shared by every
 * organization of the instance and processes one file at a time.
 *
 * - Organizations take turns, also while files keep arriving: a file of any
 *   organization is taken after about one file of each other organization,
 *   whatever the size of the backlogs.
 * - One organization alone keeps the order in which it sent its files.
 * - The files a user sends are bounded per organization, also when they
 *   arrive all at once.
 *
 * Runs when RESULTS_IMPORT_REDIS_URL is set (the db-engines job sets it):
 *   RESULTS_IMPORT_REDIS_URL=redis://127.0.0.1:6379 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=results-import-fairness.live
 *
 * Each case uses its own BullMQ prefix and removes its queue at the end.
 */
const REDIS_URL = process.env.RESULTS_IMPORT_REDIS_URL;
const describeLive = REDIS_URL ? describe : describe.skip;

describeLive('results-import queue fairness on a real Redis', () => {
  jest.setTimeout(120_000);
  let connection: { host: string; port: number };
  let queue: Queue<ResultsImportJobData>;
  let service: ScanQueueService;
  let prefix: string;

  beforeAll(() => {
    const url = new URL(REDIS_URL as string);
    connection = { host: url.hostname, port: Number(url.port || 6379) };
  });

  beforeEach(() => {
    prefix = `ri-fair-${randomUUID().slice(0, 8)}`;
    queue = new Queue(QUEUE_NAMES.RESULTS_IMPORT, { connection, prefix });
    // The real enqueue method, on the real queue: the other queues of the
    // service play no part here.
    service = Object.create(ScanQueueService.prototype) as ScanQueueService;
    Object.assign(service, {
      resultsImportQueue: queue,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  afterEach(async () => {
    delete process.env.RESULTS_IMPORT_MAX_WAITING_PER_ORG;
    await queue.obliterate({ force: true });
    await queue.close();
  });

  const job = (
    organizationId: string,
    extra: Partial<ResultsImportJobData> = {},
  ): ResultsImportJobData => {
    const projectId = randomUUID();
    const scanId = randomUUID();
    return {
      scanId,
      projectId,
      organizationId,
      branch: 'main',
      category: 'sast',
      format: 'sarif',
      fileKey: `import/${projectId}/${scanId}.sarif`,
      ...extra,
    };
  };
  /** A file of a cluster scan of the instance: ordered, never refused. */
  const clusterFile = (org: string) => job(org, { containerId: randomUUID() });

  /** One worker slot; `onTaken` runs as each job starts. */
  const startWorker = (
    onTaken: (j: Job<ResultsImportJobData>) => void | Promise<void>,
  ) =>
    new Worker<ResultsImportJobData>(
      QUEUE_NAMES.RESULTS_IMPORT,
      async (j) => {
        await onTaken(j);
        await new Promise((r) => setTimeout(r, 3));
      },
      { connection, prefix, concurrency: 1 },
    );

  const waitUntil = async (cond: () => boolean, ms = 60_000) => {
    const deadline = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it('a backlog does not starve: with other organizations sending all the time, each file waits for about one file of each other organization', async () => {
    for (let round = 0; round < 3; round += 1) {
      const order: string[] = [];
      /** For every job: how many jobs were taken between its add and its start. */
      const addedAt = new Map<string, number>();
      const waits: { org: string; others: number }[] = [];
      let sending = true;
      const send = async (org: string) => {
        const data = clusterFile(org);
        const id = await service.addResultsImportJob(data);
        addedAt.set(id, order.length);
      };
      const worker = startWorker(async (j) => {
        const at = addedAt.get(j.id as string) ?? 0;
        const between = order.slice(at);
        waits.push({
          org: j.data.organizationId,
          others: between.filter((o) => o !== j.data.organizationId).length,
        });
        order.push(j.data.organizationId);
        // B and C each keep sending: one new file as each of theirs starts.
        if (sending && j.data.organizationId !== 'a') {
          await send(j.data.organizationId);
        }
      });
      try {
        // B and C are already sending when A's scan arrives.
        await send('b');
        await send('c');
        await waitUntil(() => order.length >= 10);
        // Org A: one cluster scan of 20 files, all at once.
        await Promise.all(Array.from({ length: 20 }, () => send('a')));
        await waitUntil(() => order.filter((o) => o === 'a').length === 20);
        sending = false;
      } finally {
        await worker.close();
      }

      // Every file of A ran while B and C kept sending.
      const aPositions = order
        .map((o, i) => (o === 'a' ? i : -1))
        .filter((i) => i >= 0);
      expect(aPositions).toHaveLength(20);
      // Between two files of A, at most about one file of B and one of C.
      for (let i = 1; i < aPositions.length; i += 1) {
        expect(aPositions[i] - aPositions[i - 1] - 1).toBeLessThanOrEqual(3);
      }
      // A file of B or C, added while A's backlog waits, is not put behind it.
      for (const w of waits.filter((x) => x.org !== 'a')) {
        expect(w.others).toBeLessThanOrEqual(3);
      }
      await queue.obliterate({ force: true });
    }
  });

  it('one organization alone keeps the order of its files, also while they run', async () => {
    const sent: string[] = [];
    const ran: string[] = [];
    const worker = startWorker((j) => {
      ran.push(j.id as string);
    });
    try {
      for (let i = 0; i < 30; i += 1) {
        sent.push(await service.addResultsImportJob(clusterFile('solo')));
        if (i % 3 === 0) await new Promise((r) => setTimeout(r, 5));
      }
      await waitUntil(() => ran.length === 30);
    } finally {
      await worker.close();
    }
    expect(ran).toEqual(sent);
  });

  it('keeps the turns under the queue priority limit (renumbers), the order unchanged', async () => {
    service.resultsImportTurnRebaseAt = 8;
    const sent: string[] = [];
    const ran: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      sent.push(await service.addResultsImportJob(clusterFile('solo')));
    }
    const priorities = (await queue.getJobs(['prioritized'])).map(
      (j) => j.opts.priority as number,
    );
    expect(Math.max(...priorities)).toBeLessThanOrEqual(25);
    const worker = startWorker((j) => {
      ran.push(j.id as string);
    });
    try {
      await waitUntil(() => ran.length === 25);
    } finally {
      await worker.close();
    }
    expect(ran).toEqual(sent);
  });

  it('a burst of user imports sent at once never goes past the per-organization cap', async () => {
    process.env.RESULTS_IMPORT_MAX_WAITING_PER_ORG = '10';
    for (let round = 0; round < 4; round += 1) {
      const org = `burst-${round}`;
      const results = await Promise.allSettled(
        Array.from({ length: 40 }, () => service.addResultsImportJob(job(org))),
      );
      const admitted = results.filter((r) => r.status === 'fulfilled');
      expect(admitted).toHaveLength(10);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(r.reason).toMatchObject({
            error: { code: status.RESOURCE_EXHAUSTED },
          });
        }
      }
      // Another organization is not affected.
      await expect(
        service.addResultsImportJob(job(`other-${round}`)),
      ).resolves.toEqual(expect.any(String));
    }
  });

  it('defaults to 50 waiting user imports per organization', async () => {
    expect(DEFAULT_MAX_WAITING_IMPORTS_PER_ORG).toBe(50);
    for (let i = 0; i < 50; i += 1) {
      await service.addResultsImportJob(job('a'));
    }
    await expect(service.addResultsImportJob(job('a'))).rejects.toMatchObject({
      error: { code: status.RESOURCE_EXHAUSTED },
    });
  });

  it("frees a user import's place once the file is taken", async () => {
    process.env.RESULTS_IMPORT_MAX_WAITING_PER_ORG = '2';
    await service.addResultsImportJob(job('a'));
    await service.addResultsImportJob(job('a'));
    await expect(service.addResultsImportJob(job('a'))).rejects.toMatchObject({
      error: { code: status.RESOURCE_EXHAUSTED },
    });
    let taken = 0;
    const worker = startWorker(() => {
      taken += 1;
    });
    try {
      await waitUntil(() => taken === 2);
    } finally {
      await worker.close();
    }
    await expect(service.addResultsImportJob(job('a'))).resolves.toEqual(
      expect.any(String),
    );
  });

  it("never refuses the files of the instance's own scans, nor a repeated call", async () => {
    process.env.RESULTS_IMPORT_MAX_WAITING_PER_ORG = '3';
    const first = job('a');
    await service.addResultsImportJob(first);
    await service.addResultsImportJob(job('a'));
    await service.addResultsImportJob(job('a'));

    await expect(service.addResultsImportJob(first)).resolves.toBe(
      `results-import-${first.scanId}`,
    );
    await expect(
      service.addResultsImportJob(clusterFile('a')),
    ).resolves.toEqual(expect.any(String));
  });
});
