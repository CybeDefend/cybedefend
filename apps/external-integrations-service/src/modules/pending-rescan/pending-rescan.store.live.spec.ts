/**
 * PendingRescanStore against a real Redis.
 *
 * Every step of the deferred rescan is one Lua script, so its atomicity can
 * only be proven by Redis itself: a refused push that lands while the
 * consumer is processing the same (project, branch) must never be lost, nor
 * scanned before a newer commit.
 *
 * Skipped by default. Run against the local Docker Redis with:
 *   PENDING_RESCAN_REDIS_LIVE=1 pnpm exec jest pending-rescan.store.live
 * (REDIS_LIVE_URL defaults to redis://127.0.0.1:6379). Every key lives under
 * a prefix unique to the run, deleted afterwards.
 */
import Redis from 'ioredis';
import {
  PENDING_RESCAN_CLAIM_LEASE_MS,
  PENDING_RESCAN_RETRY_DELAY_MS,
  PENDING_RESCAN_TTL_SECONDS,
  PendingRescanRequest,
  PendingRescanStore,
} from './pending-rescan.store';

const LIVE = process.env.PENDING_RESCAN_REDIS_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

const T0 = 1_800_000_000_000;
const sha = (c: string) => c.repeat(40);

const push = (
  commit: string,
  overrides: Partial<PendingRescanRequest> = {},
): PendingRescanRequest =>
  ({
    provider: 'github',
    projectId: 'p1',
    branch: 'main',
    commitSha: sha(commit),
    githubRepositoryId: 42,
    ...overrides,
  }) as PendingRescanRequest;

describeLive('PendingRescanStore on Redis', () => {
  const prefix = `l14-live-${process.pid}-${Date.now()}`;
  let redis: Redis;
  let store: PendingRescanStore;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_LIVE_URL ?? 'redis://127.0.0.1:6379');
    store = new PendingRescanStore(redis, prefix);
  });

  afterEach(async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  const dueKey = `${prefix}:due`;

  it('records the refused push with a bounded TTL, first due after the retry delay', async () => {
    await store.record(push('a'), T0);

    const member = store.entryKey('p1', 'main');
    const stored = JSON.parse((await redis.get(member)) as string);
    expect(stored).toEqual({
      provider: 'github',
      projectId: 'p1',
      branch: 'main',
      commitSha: sha('a'),
      githubRepositoryId: 42,
      recordedAt: T0,
    });
    const ttl = await redis.ttl(member);
    expect(ttl).toBeGreaterThan(PENDING_RESCAN_TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(PENDING_RESCAN_TTL_SECONDS);
    expect(Number(await redis.zscore(dueKey, member))).toBe(
      T0 + PENDING_RESCAN_RETRY_DELAY_MS,
    );
  });

  it('keeps one entry per (project, branch): the last refused push', async () => {
    await store.record(push('a'), T0);
    await store.record(push('b'), T0 + 1_000);
    await store.record(push('c', { branch: 'develop' }), T0 + 2_000);

    expect(await redis.zcard(dueKey)).toBe(2);
    const commitOf = async (branch: string) =>
      JSON.parse((await redis.get(store.entryKey('p1', branch))) as string)
        .commitSha;
    expect(await commitOf('main')).toBe(sha('b'));
    expect(await commitOf('develop')).toBe(sha('c'));
  });

  it('claims an entry only once it is due, then leases it', async () => {
    await store.record(push('a'), T0);

    expect(await store.claimDue(10, T0)).toEqual([]);
    const due = T0 + PENDING_RESCAN_RETRY_DELAY_MS;
    const [claim] = await store.claimDue(10, due);
    expect(claim.entry?.commitSha).toBe(sha('a'));
    // A second consumer finds nothing while the lease runs...
    expect(await store.claimDue(10, due + 1_000)).toEqual([]);
    // ...and gets it back when the first one died without settling.
    const again = await store.claimDue(10, due + PENDING_RESCAN_CLAIM_LEASE_MS);
    expect(again.map((c) => c.member)).toEqual([claim.member]);
  });

  it('a push refused while the entry is leased does not shorten the lease', async () => {
    await store.record(push('a'), T0);
    const due = T0 + PENDING_RESCAN_RETRY_DELAY_MS;
    await store.claimDue(10, due);

    await store.record(push('b'), due + 1_000);

    expect(
      await store.claimDue(10, due + 2 * PENDING_RESCAN_RETRY_DELAY_MS),
    ).toEqual([]);
  });

  it('settling forgets the entry it consumed', async () => {
    await store.record(push('a'), T0);
    const [claim] = await store.claimDue(
      10,
      T0 + PENDING_RESCAN_RETRY_DELAY_MS,
    );

    expect(await store.settle(claim, T0 + 70_000)).toBe(true);

    expect(await redis.exists(claim.member)).toBe(0);
    expect(await redis.zscore(dueKey, claim.member)).toBeNull();
  });

  it('settling keeps, and schedules, a newer push refused while it was processed', async () => {
    await store.record(push('a'), T0);
    const now = T0 + PENDING_RESCAN_RETRY_DELAY_MS;
    const [claim] = await store.claimDue(10, now);
    // The rescan of `a` just started; a push of `b` is refused meanwhile.
    await store.record(push('b'), now + 500);

    expect(await store.settle(claim, now + 1_000)).toBe(false);

    const [next] = await store.claimDue(
      10,
      now + 1_000 + PENDING_RESCAN_RETRY_DELAY_MS,
    );
    expect(next.entry?.commitSha).toBe(sha('b'));
  });

  it('an entry gone when it was read (expired) leaves no schedule behind', async () => {
    await store.record(push('a'), T0);
    await redis.del(store.entryKey('p1', 'main'));
    const [claim] = await store.claimDue(
      10,
      T0 + PENDING_RESCAN_RETRY_DELAY_MS,
    );
    expect(claim.entry).toBeNull();

    expect(await store.settle(claim, T0 + 70_000)).toBe(true);
    expect(await redis.zcard(dueKey)).toBe(0);
  });

  it('an entry recorded after the read of an empty one is not lost', async () => {
    await store.record(push('a'), T0);
    await redis.del(store.entryKey('p1', 'main'));
    const [claim] = await store.claimDue(
      10,
      T0 + PENDING_RESCAN_RETRY_DELAY_MS,
    );
    await store.record(push('b'), T0 + 61_000);

    expect(await store.settle(claim, T0 + 62_000)).toBe(false);
    expect(await redis.zscore(dueKey, claim.member)).not.toBeNull();
  });

  it('a busy check re-arms the entry, once more after the retry delay', async () => {
    await store.record(push('a'), T0);
    const now = T0 + PENDING_RESCAN_RETRY_DELAY_MS;
    const [claim] = await store.claimDue(10, now);

    expect(await store.rearm(claim.member, now)).toBe(true);

    expect(Number(await redis.zscore(dueKey, claim.member))).toBe(
      now + PENDING_RESCAN_RETRY_DELAY_MS,
    );
  });

  it('re-arming an entry that expired meanwhile drops its schedule', async () => {
    await store.record(push('a'), T0);
    const [claim] = await store.claimDue(
      10,
      T0 + PENDING_RESCAN_RETRY_DELAY_MS,
    );
    await redis.del(claim.member);

    expect(await store.rearm(claim.member, T0 + 70_000)).toBe(false);
    expect(await redis.zcard(dueKey)).toBe(0);
  });

  it('a scan started for the branch supersedes the pushes refused before it, not after', async () => {
    await store.record(push('a'), T0);
    expect(await store.supersede('p1', 'main', T0 + 1, sha('z'))).toBe(true);
    expect(await redis.exists(store.entryKey('p1', 'main'))).toBe(0);
    expect(await redis.zcard(dueKey)).toBe(0);

    await store.record(push('b'), T0 + 5_000);
    expect(await store.supersede('p1', 'main', T0 + 4_000, sha('z'))).toBe(
      false,
    );
    expect(await redis.exists(store.entryKey('p1', 'main'))).toBe(1);
  });

  it('an unreadable entry is claimed with no entry, and settled away', async () => {
    const member = store.entryKey('p1', 'main');
    await redis.set(member, '{not json', 'EX', 60);
    await redis.zadd(dueKey, T0, member);

    const [claim] = await store.claimDue(10, T0);
    expect(claim).toEqual({ member, raw: '{not json', entry: null });
    expect(await store.settle(claim, T0)).toBe(true);
    expect(await redis.exists(member)).toBe(0);
  });

  // The same commit is never rescanned (nor
  // billed) twice. A start records the commit it scans; a push of that very
  // commit refused afterwards (gateway retry of a call EI did process, a
  // manual redelivery, a manual scan that read the same head) is dropped.
  describe('the commit whose scan started', () => {
    it('a push of the commit whose scan started is not recorded', async () => {
      await store.supersede('p1', 'main', T0, sha('x'));

      expect(await store.record(push('x'), T0 + 1_000)).toBe(false);

      expect(await redis.exists(store.entryKey('p1', 'main'))).toBe(0);
      expect(await redis.zcard(dueKey)).toBe(0);
    });

    it('a push of another commit is recorded', async () => {
      await store.supersede('p1', 'main', T0, sha('x'));

      expect(await store.record(push('y'), T0 + 1_000)).toBe(true);
      expect(
        await store.claimDue(10, T0 + 1_000 + PENDING_RESCAN_RETRY_DELAY_MS),
      ).toHaveLength(1);
    });

    it('remembers the started commit for as long as an entry lives', async () => {
      await store.supersede('p1', 'main', T0, sha('x'));

      const key = `${prefix}:started:p1:main`;
      expect(await redis.get(key)).toBe(sha('x'));
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(PENDING_RESCAN_TTL_SECONDS - 5);
      expect(ttl).toBeLessThanOrEqual(PENDING_RESCAN_TTL_SECONDS);
      expect(await store.startedCommit('p1', 'main')).toBe(sha('x'));
      expect(await store.startedCommit('p1', 'develop')).toBeNull();
    });

    it('a start drops a pending entry of its own commit, whenever it was recorded', async () => {
      // The refusal raced the start: recorded after startedAt.
      await store.record(push('x'), T0 + 5_000);

      expect(await store.supersede('p1', 'main', T0, sha('x'))).toBe(true);
      expect(await redis.exists(store.entryKey('p1', 'main'))).toBe(0);
      expect(await redis.zcard(dueKey)).toBe(0);
    });

    it('a start keeps a newer commit refused after it', async () => {
      await store.record(push('y'), T0 + 5_000);

      expect(await store.supersede('p1', 'main', T0, sha('x'))).toBe(false);
      expect(await redis.exists(store.entryKey('p1', 'main'))).toBe(1);
    });
  });
});
