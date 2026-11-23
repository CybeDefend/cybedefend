import { RealtimeEventPublisher } from '../realtime-event.publisher';
import RedisMock from 'ioredis-mock';

describe('RealtimeEventPublisher.publish', () => {
  let pub: RealtimeEventPublisher; let redis: any;
  beforeEach(async () => {
    redis = new RedisMock();
    // ioredis-mock shares its store across instances — flush to keep
    // tests independent (dedupe keys especially would leak across tests).
    await redis.flushall();
    pub = new RealtimeEventPublisher(redis as any, { realtimeRedisUrl: 'redis://x' });
  });

  it('SCAN_STATUS_CHANGED is published to BOTH org projects and project issues channels', async () => {
    const got: string[] = [];
    const sub = new RedisMock();
    await sub.subscribe('cybe:event:org:o1:projects', 'cybe:event:project:p1:issues');
    sub.on('message', (ch: string) => got.push(ch));
    await pub.publish({ eventId: '01', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o1', projectId: 'p1', scanId: 's1' }, payload: {} } as any);
    await new Promise((r) => setTimeout(r, 30));
    expect(got.sort()).toEqual(['cybe:event:org:o1:projects', 'cybe:event:project:p1:issues']);
  });

  it('XADDs to a stream keyed by the channel (one stream per channel) for TRIAL_UPDATED', async () => {
    await pub.publish({ eventId: '02', type: 'TRIAL_UPDATED', scope: { organizationId: 'o2' }, payload: {} } as any);
    expect(await redis.xlen('cybe:stream:billing:org:o2')).toBe(1);
  });

  it('does not throw when redis is unavailable (fire-and-forget)', async () => {
    const broken = { publish: jest.fn().mockRejectedValue(new Error('down')), xadd: jest.fn().mockRejectedValue(new Error('down')) };
    const p = new RealtimeEventPublisher(broken as any, { realtimeRedisUrl: 'x' });
    await expect(p.publish({ eventId: '03', type: 'TRIAL_UPDATED', scope: { organizationId: 'o' }, payload: {} } as any)).resolves.toBeUndefined();
  });

  it('drops events when token bucket is exhausted and increments drop counter', async () => {
    const p = new RealtimeEventPublisher(redis as any, { realtimeRedisUrl: 'x', burst: 2, refillPerSecond: 0 });
    await p.publish({ eventId: 'a', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any);
    await p.publish({ eventId: 'b', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any);
    await p.publish({ eventId: 'c', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any);
    expect(p.dropsCount('SCAN_STATUS_CHANGED:s')).toBe(1);
  });

  it('drops events with no organizationId in scope', async () => {
    await pub.publish({ eventId: 'd', type: 'SCAN_STATUS_CHANGED', scope: {}, payload: {} } as any);
    // No publish should have happened — verify by checking xlen of any stream
    expect(await redis.xlen('cybe:stream:org::projects')).toBe(0);
  });

  describe('dedupe (SETNX-based, optional)', () => {
    // Parallel callers in ScanStateManager (one per container of a scan)
    // were emitting the SAME SCAN_STATUS_CHANGED 4-8 times for one
    // transition because each loaded the scan with the same stale
    // previousState before any committed. The publisher gains an opt-in
    // dedupe-key so callers can guarantee at-most-once delivery for a
    // logical transition.

    it('publishes only once when the same dedupeKey arrives twice within the TTL', async () => {
      const xlenBefore = await redis.xlen('cybe:stream:project:p:issues');
      await pub.publish(
        { eventId: 'e1', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any,
        { dedupeKey: 'scan:s:state:running', dedupeTtlSec: 30 },
      );
      await pub.publish(
        { eventId: 'e2', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any,
        { dedupeKey: 'scan:s:state:running', dedupeTtlSec: 30 },
      );
      // Only the first call should have made it to the stream.
      expect(await redis.xlen('cybe:stream:project:p:issues') - xlenBefore).toBe(1);
    });

    it('publishes both when dedupeKeys differ (distinct transitions)', async () => {
      const xlenBefore = await redis.xlen('cybe:stream:project:p:issues');
      await pub.publish(
        { eventId: 'e3', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any,
        { dedupeKey: 'scan:s:state:running', dedupeTtlSec: 30 },
      );
      await pub.publish(
        { eventId: 'e4', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any,
        { dedupeKey: 'scan:s:state:completed', dedupeTtlSec: 30 },
      );
      expect(await redis.xlen('cybe:stream:project:p:issues') - xlenBefore).toBe(2);
    });

    it('publishes normally when no dedupeKey is passed (backwards compatible)', async () => {
      const xlenBefore = await redis.xlen('cybe:stream:project:p:issues');
      await pub.publish(
        { eventId: 'e5', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any,
      );
      await pub.publish(
        { eventId: 'e6', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any,
      );
      expect(await redis.xlen('cybe:stream:project:p:issues') - xlenBefore).toBe(2);
    });

    it('decrements the token bucket only on the first (non-deduped) emission', async () => {
      const p = new RealtimeEventPublisher(redis as any, { realtimeRedisUrl: 'x', burst: 2, refillPerSecond: 0 });
      await p.publish(
        { eventId: 'a', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any,
        { dedupeKey: 'scan:s:state:running', dedupeTtlSec: 30 },
      );
      // Second call with same dedupeKey must be skipped BEFORE consuming a
      // token, otherwise rapid duplicate transitions could starve the bucket
      // for the legitimate next state.
      await p.publish(
        { eventId: 'b', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any,
        { dedupeKey: 'scan:s:state:running', dedupeTtlSec: 30 },
      );
      // Burst was 2; one consumed → 1 token left.
      await p.publish(
        { eventId: 'c', type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' }, payload: {} } as any,
      );
      expect(p.dropsCount('SCAN_STATUS_CHANGED:s')).toBe(0);
    });
  });
});
