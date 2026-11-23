import { DataSource } from 'typeorm';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from '../../core/db/live-database';
import { OrganizationStatisticsEntity } from '../../entities/organization-statistics.entity';
import { OrganizationStatisticsRepository } from './organization-statistics.repository';

/**
 * LIVE spec: the organization statistics debounce on both engines —
 * the portable upsert (`ON DUPLICATE KEY UPDATE` / `ON CONFLICT DO UPDATE`),
 * the affected rows of an UPDATE, the database clock and a Date compared
 * with a `timestamp` column. Run it in a time zone ahead of UTC, so a Date
 * parameter or a timestamp read back in local time moves by an hour:
 *
 *   TZ=Europe/Paris AR_ORG_STATS_LIVE=1 LIVE_DB_TYPE=mysql \
 *     AR_ORG_STATS_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=organization-statistics.repository.live
 *   TZ=Europe/Paris AR_ORG_STATS_LIVE=1 LIVE_DB_TYPE=postgres \
 *     AR_ORG_STATS_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=organization-statistics.repository.live
 *
 * The schema is built by the dialect's migration tracks in a throwaway
 * database, dropped at the end.
 */
const LIVE = liveEnabled('AR_ORG_STATS');
const describeLive = LIVE ? describe : describe.skip;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describeLive('OrganizationStatisticsRepository on both engines', () => {
  jest.setTimeout(120_000);
  const HOOK_TIMEOUT = 240_000;
  let live: LiveDatabase;
  let ds: DataSource;
  let repository: OrganizationStatisticsRepository;
  let n = 0;
  const nextOrg = () => `org-stats-${(n += 1)}`;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'ar_org_stats',
      envPrefix: 'AR_ORG_STATS',
      migrations: 'track',
    });
    ds = live.dataSource;
    repository = new OrganizationStatisticsRepository(
      ds.getRepository(OrganizationStatisticsEntity),
    );
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await live?.drop();
  }, HOOK_TIMEOUT);

  const rowsOf = (organizationId: string) =>
    ds.getRepository(OrganizationStatisticsEntity).countBy({ organizationId });

  it('markDirty inserts once then keeps the first dirty_since', async () => {
    const org = nextOrg();
    await repository.markDirty(org);
    const first = await repository.readTimings(org);
    expect(first.dirtySince).toBeGreaterThan(0);
    expect(first.lastEventAt).toBe(first.dirtySince);

    await pause(30);
    await repository.markDirty(org);
    const second = await repository.readTimings(org);

    expect(await rowsOf(org)).toBe(1);
    expect(second.dirtySince).toBe(first.dirtySince);
    expect(second.lastEventAt).toBeGreaterThan(first.lastEventAt);
    expect(second.computedAt).toBe(0);
  });

  it('markDirtyIfPresent never inserts and says whether it marked', async () => {
    const absent = nextOrg();
    await expect(repository.markDirtyIfPresent(absent)).resolves.toBe(false);
    expect(await rowsOf(absent)).toBe(0);
    expect(await repository.readTimings(absent)).toBeNull();

    // A computed, clean row: marking it sets dirty_since.
    const present = nextOrg();
    await repository.saveInitial(present, { projects: 3 });
    const clean = await repository.readTimings(present);
    expect(clean.dirtySince).toBe(0);
    expect(clean.computedAt).toBeGreaterThan(0);

    await expect(repository.markDirtyIfPresent(present)).resolves.toBe(true);
    const marked = await repository.readTimings(present);
    expect(marked.dirtySince).toBeGreaterThan(0);
    expect(marked.lastEventAt).toBe(marked.dirtySince);

    // Already dirty: marked again, dirty_since kept.
    await pause(30);
    await expect(repository.markDirtyIfPresent(present)).resolves.toBe(true);
    const again = await repository.readTimings(present);
    expect(again.dirtySince).toBe(marked.dirtySince);
    expect(again.lastEventAt).toBeGreaterThan(marked.lastEventAt);
    expect(await rowsOf(present)).toBe(1);
  });

  it('finishCompute clears dirty_since only when no event landed during the compute', async () => {
    // No event during the compute: clean afterwards, payload stored.
    const quiet = nextOrg();
    await repository.markDirty(quiet);
    await pause(30);
    const quietStart = (await repository.readTimings(quiet)).now;
    await expect(
      repository.finishCompute(quiet, { projects: 1 }, quietStart),
    ).resolves.toEqual({ stillDirty: false });
    const quietAfter = await repository.readTimings(quiet);
    expect(quietAfter.dirtySince).toBe(0);
    expect(quietAfter.computedAt).toBeGreaterThanOrEqual(quietStart);
    expect((await repository.findByOrgId(quiet)).stats).toEqual({
      projects: 1,
    });

    // An event between the compute's start and its finish: still dirty.
    const busy = nextOrg();
    await repository.markDirty(busy);
    const firstEvent = (await repository.readTimings(busy)).dirtySince;
    await pause(30);
    const busyStart = (await repository.readTimings(busy)).now;
    await pause(30);
    await repository.markDirty(busy);
    await expect(
      repository.finishCompute(busy, { projects: 2 }, busyStart),
    ).resolves.toEqual({ stillDirty: true });
    const busyAfter = await repository.readTimings(busy);
    expect(busyAfter.dirtySince).toBe(firstEvent);
    expect(busyAfter.computedAt).toBeGreaterThan(0);
  });

  it('readTimings returns the database clock in milliseconds', async () => {
    const org = nextOrg();
    await repository.markDirty(org);
    const before = Date.now();
    const timings = await repository.readTimings(org);
    const after = Date.now();

    expect(Number.isInteger(timings.now)).toBe(true);
    // The database clock is the host's here (same machine): it reads as an
    // instant, never shifted by the host's time zone.
    expect(timings.now).toBeGreaterThanOrEqual(before - 5_000);
    expect(timings.now).toBeLessThanOrEqual(after + 5_000);
    expect(Math.abs(timings.now - timings.lastEventAt)).toBeLessThan(5_000);
    expect(timings.computedAt).toBe(0);
  });
});
