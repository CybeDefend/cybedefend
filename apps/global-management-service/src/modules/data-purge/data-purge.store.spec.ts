import {
  CapturedStatement,
  createSqlCaptureDataSource,
} from 'src/test-utils/sql-capture.util';
import { DataPurgeStore } from './data-purge.store';

const T0 = new Date('2026-10-27T10:00:00.000Z');
const UNTIL = new Date('2026-10-27T10:10:00.000Z');

/** Collapses the whitespace TypeORM puts in its SQL. */
const flat = (s: CapturedStatement) => s.sql.replace(/\s+/g, ' ').trim();

async function storeAnswering(
  answer: (
    s: CapturedStatement,
  ) => Record<string, unknown>[] | { affected: number },
) {
  const { dataSource, statements } = await createSqlCaptureDataSource(answer);
  return { store: new DataPurgeStore(dataSource), statements };
}

describe('DataPurgeStore', () => {
  it('claims a pending, due job whose lease is free, in one conditional UPDATE', async () => {
    const { store, statements } = await storeAnswering(() => ({ affected: 1 }));

    await expect(store.claim('j1', 'tok', T0, UNTIL)).resolves.toBe(true);

    expect(statements).toHaveLength(1);
    const sql = flat(statements[0]);
    expect(sql).toMatch(
      /^UPDATE `data_purge_job` SET `leaseUntil` = \?, `leaseToken` = \?/,
    );
    expect(sql).toContain('`id` = ?');
    expect(sql).toContain("`status` = 'pending'");
    expect(sql).toContain('`nextAttemptAt` <= ?');
    expect(sql).toContain('(`leaseUntil` IS NULL OR `leaseUntil` < ?)');
    expect(statements[0].params).toEqual([UNTIL, 'tok', 'j1', T0, T0]);
  });

  it('a claim that matched no row is not a claim', async () => {
    const { store } = await storeAnswering(() => ({ affected: 0 }));
    await expect(store.claim('j1', 'tok', T0, UNTIL)).resolves.toBe(false);
  });

  it('renews and releases the lease only with its token', async () => {
    let affected = 1;
    const { store, statements } = await storeAnswering(() => ({ affected }));

    await expect(store.renew('j1', 'tok', UNTIL)).resolves.toBe(true);
    affected = 0;
    await expect(store.renew('j1', 'tok', UNTIL)).resolves.toBe(false);
    await store.release('j1', 'tok');

    expect(flat(statements[0])).toBe(
      'UPDATE `data_purge_job` SET `leaseUntil` = ? WHERE `id` = ? AND `leaseToken` = ?',
    );
    expect(statements[0].params).toEqual([UNTIL, 'j1', 'tok']);
    expect(flat(statements[2])).toBe(
      'UPDATE `data_purge_job` SET `leaseUntil` = NULL, `leaseToken` = NULL WHERE `id` = ? AND `leaseToken` = ?',
    );
    expect(statements[2].params).toEqual(['j1', 'tok']);
  });

  it('updates a job only while it holds an unexpired lease', async () => {
    const { store, statements } = await storeAnswering(() => ({ affected: 1 }));

    const before = Date.now();
    await expect(
      store.updateJob('j1', 'tok', { status: 'halted' }),
    ).resolves.toBe(true);

    const sql = flat(statements[0]);
    expect(sql).toMatch(/^UPDATE `data_purge_job` SET `status` = \?/);
    expect(sql).toMatch(
      /WHERE `id` = \? AND `leaseToken` = \? AND `leaseUntil` > \?$/,
    );
    const [value, id, token, now] = statements[0].params as [
      string,
      string,
      string,
      Date,
    ];
    expect([value, id, token]).toEqual(['halted', 'j1', 'tok']);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('writes a step only while its job is leased by the token, unexpired', async () => {
    let affected = 1;
    const { store, statements } = await storeAnswering(() => ({ affected }));

    const before = Date.now();
    await expect(
      store.updateStep('j1', 'tok', 'agent', {
        attempts: 2,
        lastErrorCode: 'UNAVAILABLE',
      }),
    ).resolves.toBe(true);

    const sql = flat(statements[0]);
    expect(sql).toBe(
      'UPDATE `data_purge_step` `s` INNER JOIN `data_purge_job` `j` ON `j`.`id` = `s`.`jobId` SET `s`.`attempts` = ?, `s`.`lastErrorCode` = ? WHERE `s`.`jobId` = ? AND `s`.`step` = ? AND `j`.`leaseToken` = ? AND `j`.`leaseUntil` > ?',
    );
    const params = statements[0].params;
    expect(params.slice(0, 5)).toEqual([
      2,
      'UNAVAILABLE',
      'j1',
      'agent',
      'tok',
    ]);
    expect((params[5] as Date).getTime()).toBeGreaterThanOrEqual(before);

    // Another runner holds the job, or the lease expired: nothing matched.
    affected = 0;
    await expect(
      store.updateStep('j1', 'tok', 'agent', { status: 'done' }),
    ).resolves.toBe(false);
  });

  it('lists the due jobs with a free lease, oldest first, bounded', async () => {
    const { store, statements } = await storeAnswering(() => [
      { id: 'j1' },
      { id: 'j2' },
    ]);

    await expect(store.dueJobIds(T0, 50)).resolves.toEqual(['j1', 'j2']);

    const sql = flat(statements[0]);
    expect(sql).toContain("`status` = 'pending'");
    expect(sql).toContain('`nextAttemptAt` <= ?');
    expect(sql).toContain('(`leaseUntil` IS NULL OR `leaseUntil` < ?)');
    // The bound is a parameter (db-dialect's MySQL text), checked first.
    expect(sql).toMatch(/ORDER BY `nextAttemptAt` ASC LIMIT \?$/);
    expect(statements[0].params).toEqual([T0, T0, 50]);
    await expect(store.dueJobIds(T0, 0)).rejects.toThrow(
      'DATA_PURGE_INVALID_LIMIT',
    );
  });

  it('reads every pending job deleted before a date, each with one pending step', async () => {
    const { store, statements } = await storeAnswering((s) =>
      /FROM `data_purge_job`/.test(s.sql)
        ? [
            { id: 'j1', kind: 'project', status: 'pending' },
            { id: 'j2', kind: 'organization', status: 'pending' },
            { id: 'j3', kind: 'team', status: 'pending' },
            { id: 'j4', kind: 'project', status: 'halted' },
          ]
        : [
            // j1: a failing step wins over one that only needs a call.
            {
              jobId: 'j1',
              step: 'analysis_reporting',
              attempts: 0,
              lastErrorCode: null,
              nextAttemptAt: T0,
            },
            {
              jobId: 'j1',
              step: 'agent',
              attempts: 3,
              lastErrorCode: 'UNAVAILABLE',
              nextAttemptAt: UNTIL,
            },
            // j2: no failing step, the one due earliest.
            {
              jobId: 'j2',
              step: 'permify',
              attempts: 0,
              lastErrorCode: null,
              nextAttemptAt: UNTIL,
            },
            {
              jobId: 'j2',
              step: 'policy',
              attempts: 0,
              lastErrorCode: null,
              nextAttemptAt: T0,
            },
            // j3: no pending step.
            {
              jobId: 'j4',
              step: 'agent',
              attempts: 0,
              lastErrorCode: null,
              nextAttemptAt: T0,
            },
          ],
    );

    await expect(store.stuckJobs(T0, 500)).resolves.toEqual([
      {
        jobId: 'j1',
        kind: 'project',
        step: 'agent',
        attempts: 3,
        lastErrorCode: 'UNAVAILABLE',
        halted: false,
      },
      {
        jobId: 'j2',
        kind: 'organization',
        step: 'policy',
        attempts: 0,
        lastErrorCode: null,
        halted: false,
      },
      {
        jobId: 'j3',
        kind: 'team',
        step: null,
        attempts: null,
        lastErrorCode: null,
        halted: false,
      },
      // A halted job, whatever its age: it waits for an operator.
      {
        jobId: 'j4',
        kind: 'project',
        step: 'agent',
        attempts: 0,
        lastErrorCode: null,
        halted: true,
      },
    ]);
    const jobs = flat(statements[0]);
    expect(jobs).toContain(
      "(`status` = 'pending' AND `deletedAt` < ?) OR `status` = 'halted'",
    );
    expect(jobs).toMatch(/LIMIT \?$/);
    expect(statements[0].params).toEqual([T0, 500]);
    const steps = flat(statements[1]);
    expect(steps).toContain("`status` = 'pending'");
    expect(steps).toContain('`jobId` IN (?, ?, ?, ?)');
    expect(statements[1].params).toEqual(['j1', 'j2', 'j3', 'j4']);
  });

  it('reads no step when no job is stuck', async () => {
    const { store, statements } = await storeAnswering(() => []);
    await expect(store.stuckJobs(T0, 500)).resolves.toEqual([]);
    expect(statements).toHaveLength(1);
  });

  it.each([
    ['project', 'project'],
    ['team', 'team'],
    ['organization', 'organization'],
  ] as const)(
    'looks the %s subject up in its own table',
    async (kind, table) => {
      const { store, statements } = await storeAnswering(() => [{ cnt: 1 }]);

      await expect(store.subjectExists(kind, 'id-1')).resolves.toBe(true);

      expect(flat(statements[0])).toContain(`FROM \`${table}\``);
      expect(statements[0].params).toContain('id-1');
    },
  );

  it('a subject not found does not exist', async () => {
    const { store } = await storeAnswering(() => [{ cnt: 0 }]);
    await expect(store.subjectExists('project', 'id-1')).resolves.toBe(false);
  });
});
