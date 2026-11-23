import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createLiveDatabase, liveEnabled } from 'src/core/db/live-database';
import { DataPurgeJob } from 'src/entities/data-purge-job.entity';
import { DataPurgeStep } from 'src/entities/data-purge-step.entity';
import { Organization } from 'src/entities/organization.entity';
import { DataPurgeStore } from './data-purge.store';

/**
 * LIVE spec of the purge ledger store against a REAL MySQL or
 * PostgreSQL, built by the migrations of global-management.
 *
 * Every write that decides who runs a purge job is one conditional UPDATE
 * decided by the rows it matched: the claim, the renewal, the release, and the
 * step and job writes that only apply under a live lease (the step write is a
 * multi-table UPDATE, `UPDATE … JOIN` on MySQL, `UPDATE … FROM` on
 * PostgreSQL). Mocks cannot show that either engine matches the rows these
 * statements say.
 *
 * Skipped unless `GM_DATA_PURGE_LIVE=1`. The engine is `LIVE_DB_TYPE` (mysql
 * by default); the server is `GM_DATA_PURGE_MYSQL_URL` / `GM_DATA_PURGE_PG_URL`.
 * It creates a throwaway database and drops it at the end.
 *
 *   GM_DATA_PURGE_LIVE=1 LIVE_DB_TYPE=postgres \
 *     GM_DATA_PURGE_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --testPathPatterns=data-purge.store.live --runInBand
 */
const describeLive = liveEnabled('GM_DATA_PURGE') ? describe : describe.skip;

describeLive('DataPurgeStore on a real database', () => {
  jest.setTimeout(180_000);

  let dataSource: DataSource;
  let drop: () => Promise<void>;
  let store: DataPurgeStore;

  beforeAll(async () => {
    ({ dataSource, drop } = await createLiveDatabase({
      prefix: 'gm_data_purge_store',
      envPrefix: 'GM_DATA_PURGE',
    }));
    store = new DataPurgeStore(dataSource);
  });

  afterAll(async () => {
    await drop?.();
  });

  const MINUTE = 60_000;
  const at = (base: Date, minutes: number) =>
    new Date(base.getTime() + minutes * MINUTE);

  async function job(
    patch: Partial<DataPurgeJob> = {},
    steps: Array<Partial<DataPurgeStep>> = [],
  ): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    await dataSource.getRepository(DataPurgeJob).insert({
      id,
      kind: 'project',
      subjectId: randomUUID(),
      organizationId: randomUUID(),
      teamIds: null,
      deletedAt: at(now, -60),
      status: 'pending',
      pass: 1,
      nextAttemptAt: at(now, -1),
      leaseUntil: null,
      leaseToken: null,
      completedAt: null,
      ...patch,
    });
    for (const step of steps) {
      await dataSource.getRepository(DataPurgeStep).insert({
        jobId: id,
        step: 'agent',
        status: 'pending',
        attempts: 0,
        nextAttemptAt: at(now, -1),
        lastErrorCode: null,
        doneAt: null,
        deleted: null,
        ...step,
      });
    }
    return id;
  }

  it('a lease is taken once, renewed by its holder only, and released', async () => {
    const id = await job();
    const now = new Date();

    const claims = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.claim(id, `tok-${i}`, now, at(now, 10)),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    const holder = `tok-${claims.indexOf(true)}`;

    // Leased: no second claim, even by its holder.
    await expect(store.claim(id, holder, now, at(now, 10))).resolves.toBe(
      false,
    );
    await expect(store.renew(id, 'someone-else', at(now, 20))).resolves.toBe(
      false,
    );
    await expect(store.renew(id, holder, at(now, 20))).resolves.toBe(true);
    const renewed = await store.getJob(id);
    expect(renewed.leaseToken).toBe(holder);
    expect(renewed.leaseUntil.getTime()).toBe(at(now, 20).getTime());

    // A release by another token leaves the lease in place.
    await store.release(id, 'someone-else');
    expect((await store.getJob(id)).leaseToken).toBe(holder);
    await store.release(id, holder);
    const released = await store.getJob(id);
    expect(released.leaseToken).toBeNull();
    expect(released.leaseUntil).toBeNull();

    // Free again: it can be claimed.
    await expect(store.claim(id, 'next', now, at(now, 10))).resolves.toBe(true);
  });

  it('a step write applies only under a live lease (UPDATE … JOIN)', async () => {
    const id = await job({}, [{ step: 'agent' }, { step: 'policy' }]);
    const now = new Date();
    await expect(store.claim(id, 'tok', now, at(now, 10))).resolves.toBe(true);

    await expect(
      store.updateStep(id, 'tok', 'agent', {
        status: 'done',
        attempts: 2,
        lastErrorCode: 'UNAVAILABLE',
        doneAt: now,
        deleted: { rows: 3 },
      }),
    ).resolves.toBe(true);
    // Another token: nothing written.
    await expect(
      store.updateStep(id, 'other', 'policy', { attempts: 9 }),
    ).resolves.toBe(false);

    const steps = await store.getSteps(id);
    const agent = steps.find((s) => s.step === 'agent');
    const policy = steps.find((s) => s.step === 'policy');
    expect(agent).toMatchObject({
      status: 'done',
      attempts: 2,
      lastErrorCode: 'UNAVAILABLE',
      deleted: { rows: 3 },
    });
    expect(agent.doneAt.getTime()).toBe(now.getTime());
    expect(policy.attempts).toBe(0);

    // A job write under the lease applies, and only under it.
    await expect(
      store.updateJob(id, 'tok', { pass: 2, nextAttemptAt: at(now, 5) }),
    ).resolves.toBe(true);
    await expect(
      store.updateJob(id, 'other', { status: 'halted' }),
    ).resolves.toBe(false);
    const written = await store.getJob(id);
    expect(written.pass).toBe(2);
    expect(written.status).toBe('pending');

    // A lease that lapsed writes nothing, step or job.
    const lapsed = await job({}, [{ step: 'agent' }]);
    await dataSource
      .getRepository(DataPurgeJob)
      .update(
        { id: lapsed },
        { leaseToken: 'tok', leaseUntil: at(new Date(), -1) },
      );
    await expect(
      store.updateStep(lapsed, 'tok', 'agent', { attempts: 5 }),
    ).resolves.toBe(false);
    await expect(
      store.updateJob(lapsed, 'tok', { status: 'done' }),
    ).resolves.toBe(false);
    expect((await store.getSteps(lapsed))[0].attempts).toBe(0);
  });

  it('pending jobs come back oldest first, limited', async () => {
    // Far in the past, so no other test's job comes before them.
    const base = new Date('2001-01-01T00:00:00.000Z');
    const third = await job({ nextAttemptAt: at(base, 3) });
    const first = await job({ nextAttemptAt: at(base, 1) });
    const second = await job({ nextAttemptAt: at(base, 2) });
    // Not due, leased, or done: never listed.
    await job({ nextAttemptAt: at(new Date(), 60) });
    await job({
      nextAttemptAt: at(base, 0),
      leaseToken: 'x',
      leaseUntil: at(new Date(), 10),
    });
    await job({ nextAttemptAt: at(base, 0), status: 'done' });

    await expect(store.dueJobIds(new Date(), 2)).resolves.toEqual([
      first,
      second,
    ]);
    const all = await store.dueJobIds(new Date(), 100);
    expect(all.slice(0, 3)).toEqual([first, second, third]);

    // The stuck jobs read their pending steps with IN (…).
    const stuck = await job({ deletedAt: at(base, -10) }, [
      { step: 'agent', attempts: 4, lastErrorCode: 'UNAVAILABLE' },
      { step: 'policy' },
    ]);
    const reported = await store.stuckJobs(at(base, -5), 10);
    expect(reported).toEqual([
      {
        jobId: stuck,
        kind: 'project',
        step: 'agent',
        attempts: 4,
        lastErrorCode: 'UNAVAILABLE',
        halted: false,
      },
    ]);
  });

  it('a row count of a purged table is read as a number', async () => {
    const organization = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        name: 'Org',
        industry: 'it',
        country: 'FR',
      } as Partial<Organization>),
    );
    await expect(
      store.subjectExists('organization', organization.id),
    ).resolves.toBe(true);
    await expect(
      store.subjectExists('organization', randomUUID()),
    ).resolves.toBe(false);
    await expect(store.subjectExists('project', randomUUID())).resolves.toBe(
      false,
    );
  });
});
