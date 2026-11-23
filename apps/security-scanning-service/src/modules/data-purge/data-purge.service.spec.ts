import { status } from '@grpc/grpc-js';
import { DataPurgeService } from './data-purge.service';
import { PROJECT_PURGE_TABLES } from './purge-tables';

const PROJECT_ID = '0b9f2c1e-5a3d-4c2b-9e1f-7d6a5b4c3d2e';
const ORG_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const FUTURE = () => Date.now() + 60_000;

const NOT_STARTED_SQL =
  "DELETE FROM `scan` WHERE `projectId` = ? AND `state` IN ('queued', 'waiting_for_file') LIMIT ?";
const ALL_SQL = 'DELETE FROM `scan` WHERE `projectId` = ? LIMIT ?';
const CURSOR_SQL =
  'DELETE FROM `git_history_cursor` WHERE `projectId` = ? LIMIT ?';

type Row = { podName: string; scannerType: string | null };

/** Answers each kind of statement from its own list (the last one repeats). */
function makeDataSource(opts: {
  runningPods?: Row[];
  notStarted?: number[];
  all?: number[];
  cursors?: number[];
}) {
  const lists = {
    [NOT_STARTED_SQL]: [...(opts.notStarted ?? [0])],
    [ALL_SQL]: [...(opts.all ?? [0])],
    [CURSOR_SQL]: [...(opts.cursors ?? [0])],
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (/^\s*SELECT/i.test(sql)) return opts.runningPods ?? [];
    const list = lists[sql];
    if (!list) throw new Error(`unexpected statement ${sql}`);
    const affectedRows = list.length > 1 ? list.shift() : list[0];
    return { affectedRows };
  });
  return { query };
}

/** The strict dependency: resolves on success or a 404, throws otherwise. */
function makeKube() {
  return { deletePodAndSecretsStrict: jest.fn().mockResolvedValue(undefined) };
}

function build(ds: ReturnType<typeof makeDataSource>, kube = makeKube()) {
  // The purge reaches the pods through SCANNER_PODS_PORT; the
  // assertions still read the same jest.fn, now as deleteScannerPodStrict.
  return {
    service: new DataPurgeService(
      ds as never,
      {
        deleteScannerPodStrict: kube.deletePodAndSecretsStrict,
      } as never,
    ),
    kube,
  };
}

const statements = (ds: ReturnType<typeof makeDataSource>) =>
  ds.query.mock.calls.map(([sql]) => sql);
const indexOf = (ds: ReturnType<typeof makeDataSource>, pred: RegExp) =>
  statements(ds).findIndex((sql) => pred.test(sql));

describe('DataPurgeService.purgeProject', () => {
  it('deletes the scans that have no pod yet before reading the running pods', async () => {
    const ds = makeDataSource({
      runningPods: [{ podName: 'scan-pod-sast-a', scannerType: 'sast' }],
    });
    const { service } = build(ds);

    await service.purgeProject(PROJECT_ID, ORG_ID, FUTURE());

    expect(statements(ds)[0]).toBe(NOT_STARTED_SQL);
    expect(ds.query.mock.calls[0][1]).toEqual([PROJECT_ID, 1000]);
    expect(indexOf(ds, /^SELECT/)).toBeGreaterThan(0);
  });

  it('stops the pods of a running scan before deleting it', async () => {
    const ds = makeDataSource({
      runningPods: [
        { podName: 'scan-pod-sast-a', scannerType: 'sast' },
        { podName: 'scan-pod-sca-b', scannerType: 'sca' },
      ],
    });
    const { service, kube } = build(ds);

    const result = await service.purgeProject(PROJECT_ID, ORG_ID, FUTURE());

    const selectAt = indexOf(ds, /^SELECT/);
    const [select, params] = ds.query.mock.calls[selectAt];
    expect(select).toContain("s.`state` = 'running'");
    expect(params).toEqual([PROJECT_ID]);

    expect(kube.deletePodAndSecretsStrict).toHaveBeenCalledTimes(2);
    expect(kube.deletePodAndSecretsStrict).toHaveBeenCalledWith(
      'scan-pod-sast-a',
      'sast',
    );
    expect(kube.deletePodAndSecretsStrict).toHaveBeenCalledWith(
      'scan-pod-sca-b',
      'sca',
    );

    const allAt = statements(ds).indexOf(ALL_SQL);
    const allOrder = ds.query.mock.invocationCallOrder[allAt];
    for (const order of kube.deletePodAndSecretsStrict.mock
      .invocationCallOrder) {
      expect(order).toBeLessThan(allOrder);
    }
    expect(result).toEqual({
      complete: true,
      deleted: { pods: 2, scan: 0, git_history_cursor: 0 },
    });
  });

  it("deletes the project's scans", async () => {
    const ds = makeDataSource({ notStarted: [7], all: [1000, 1000, 12] });
    const { service } = build(ds);

    const result = await service.purgeProject(PROJECT_ID, ORG_ID, FUTURE());

    expect(statements(ds)).toEqual([
      NOT_STARTED_SQL,
      expect.stringMatching(/^SELECT/),
      ALL_SQL,
      ALL_SQL,
      ALL_SQL,
      CURSOR_SQL,
    ]);
    for (const [sql, params] of ds.query.mock.calls) {
      if (sql.startsWith('DELETE')) expect(params).toEqual([PROJECT_ID, 1000]);
    }
    expect(PROJECT_PURGE_TABLES.map((t) => t.table)).toEqual([
      'scan',
      'scan',
      'git_history_cursor',
    ]);
    expect(result).toEqual({
      complete: true,
      deleted: { pods: 0, scan: 2019, git_history_cursor: 0 },
    });
  });

  it.each(['', 'x', '%', '*', 'reports', '../', `${PROJECT_ID}/`])(
    'refuses a malformed id and deletes nothing (%p)',
    async (bad) => {
      const ds = makeDataSource({});
      const { service, kube } = build(ds);

      await expect(
        service.purgeProject(bad, ORG_ID, FUTURE()),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.INVALID_ARGUMENT }),
      });
      await expect(
        service.purgeProject(PROJECT_ID, bad, FUTURE()),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: status.INVALID_ARGUMENT }),
      });
      expect(ds.query).not.toHaveBeenCalled();
      expect(kube.deletePodAndSecretsStrict).not.toHaveBeenCalled();
    },
  );

  it('stops at the deadline and resumes', async () => {
    // Past the deadline, one batch at most, whichever stage it is in.
    const ds = makeDataSource({ notStarted: [1000] });
    const { service } = build(ds);
    const first = await service.purgeProject(
      PROJECT_ID,
      ORG_ID,
      Date.now() - 1,
    );
    expect(statements(ds)).toEqual([NOT_STARTED_SQL]);
    expect(first).toEqual({
      complete: false,
      deleted: { pods: 0, scan: 1000, git_history_cursor: 0 },
    });

    const ds2 = makeDataSource({ notStarted: [3] });
    const { service: past } = build(ds2);
    const second = await past.purgeProject(PROJECT_ID, ORG_ID, Date.now() - 1);
    expect(statements(ds2)).toEqual([NOT_STARTED_SQL]);
    expect(second.complete).toBe(false);

    const ds3 = makeDataSource({ notStarted: [0], all: [400] });
    const { service: again } = build(ds3);
    const third = await again.purgeProject(PROJECT_ID, ORG_ID, FUTURE());
    expect(third).toEqual({
      complete: true,
      deleted: { pods: 0, scan: 400, git_history_cursor: 0 },
    });
  });

  it('is idempotent', async () => {
    const ds = makeDataSource({});
    const { service, kube } = build(ds);

    const result = await service.purgeProject(PROJECT_ID, ORG_ID, FUTURE());

    expect(result).toEqual({
      complete: true,
      deleted: { pods: 0, scan: 0, git_history_cursor: 0 },
    });
    expect(kube.deletePodAndSecretsStrict).not.toHaveBeenCalled();
  });

  it('a pod already deleted does not fail the purge', async () => {
    // The strict path answers a 404 by resolving (kubernete.service.spec).
    const ds = makeDataSource({
      runningPods: [{ podName: 'scan-pod-iac-gone', scannerType: 'iac' }],
      all: [1],
    });
    const { service } = build(ds);

    const result = await service.purgeProject(PROJECT_ID, ORG_ID, FUTURE());

    expect(result).toEqual({
      complete: true,
      deleted: { pods: 1, scan: 1, git_history_cursor: 0 },
    });
  });

  it.each([403, 500])(
    'keeps the running scans when the cluster answers %i, so a retry still finds the pods',
    async (code) => {
      const ds = makeDataSource({
        runningPods: [
          { podName: 'scan-pod-sast-a', scannerType: 'sast' },
          { podName: 'scan-pod-sca-b', scannerType: 'sca' },
        ],
      });
      const kube = makeKube();
      kube.deletePodAndSecretsStrict
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          Object.assign(new Error(`HTTP ${code}`), { code }),
        );
      const { service } = build(ds, kube);

      await expect(
        service.purgeProject(PROJECT_ID, ORG_ID, FUTURE()),
      ).rejects.toMatchObject({
        error: { code: status.UNAVAILABLE, message: 'UNAVAILABLE' },
      });
      expect(statements(ds)).not.toContain(ALL_SQL);
    },
  );
});
