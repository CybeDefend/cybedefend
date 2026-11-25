import RedisMock from 'ioredis-mock';
import { firstValueFrom } from 'rxjs';
import { MembershipRegistry } from '../membership.registry';
import {
  REALTIME_PERMISSION_MAX_CONSECUTIVE_ERRORS,
  REALTIME_PERMISSION_RECHECK_MS,
  REALTIME_STREAM_MAX_LIFETIME_MS,
  RealtimeStreamFactory,
} from '../realtime-stream.factory';
import type { StreamAuthorizer } from '../stream-authorization';

type AnyFn = (...args: unknown[]) => unknown;

const fakeReq = (exp?: number) => {
  const handlers: Record<string, AnyFn[]> = {};
  return {
    user: { sub: 'u1', exp },
    raw: {
      on: (e: string, cb: AnyFn) => {
        (handlers[e] ??= []).push(cb);
      },
      _emit: (e: string) => handlers[e]?.forEach((cb) => cb()),
    },
    headers: {},
  };
};

describe('RealtimeStreamFactory', () => {
  let sub: any;
  let pub: any;
  let registry: MembershipRegistry;
  let factory: RealtimeStreamFactory;

  beforeEach(() => {
    sub = new RedisMock();
    pub = new RedisMock();
    registry = new MembershipRegistry();
    factory = new RealtimeStreamFactory(sub as any, registry);
  });

  afterEach(() => {
    // Restore real timers if fake timers were used
    jest.useRealTimers();
  });

  it('emits a connected event first', async () => {
    const req = fakeReq();
    const stream = factory.createScopedStream({
      channels: ['cybe:event:org:o:projects'],
      request: req,
    });
    const first = await firstValueFrom(stream);
    const data = JSON.parse((first as any).data);
    expect(data.type).toBe('connected');
    expect(typeof data.connectionId).toBe('string');
    req.raw._emit('close');
  });

  it('forwards Redis pub/sub messages on subscribed channels to the stream', async () => {
    const req = fakeReq();
    const events: any[] = [];
    const stream = factory.createScopedStream({
      channels: ['cybe:event:org:o:projects'],
      request: req,
    });
    const sub2 = stream.subscribe((m: any) => events.push(JSON.parse(m.data)));
    await new Promise((r) => setTimeout(r, 30));
    await pub.publish(
      'cybe:event:org:o:projects',
      JSON.stringify({ type: 'SCAN_STATUS_CHANGED', payload: {} }),
    );
    await new Promise((r) => setTimeout(r, 30));
    sub2.unsubscribe();
    req.raw._emit('close');
    expect(events.find((e) => e.type === 'SCAN_STATUS_CHANGED')).toBeDefined();
  });

  describe('organisation / team channels (broad scope, derived from the channel)', () => {
    const scanFailed = {
      eventId: 'evt-1',
      type: 'SCAN_STATUS_CHANGED',
      timestamp: '2026-10-09T10:00:00.000Z',
      scope: { organizationId: 'o', projectId: 'p-hidden', scanId: 's-hidden' },
      payload: {
        scanStatusChanged: { state: 'failed', errorMessage: 'clone failed' },
      },
    };

    const collect = async (
      channels: string[],
      publishOn: string,
      env: unknown,
    ) => {
      const req = fakeReq();
      const events: any[] = [];
      const s = factory
        .createScopedStream({ channels, request: req })
        .subscribe((m: any) => events.push(JSON.parse(m.data)));
      await new Promise((r) => setTimeout(r, 30));
      await pub.publish(publishOn, JSON.stringify(env));
      await new Promise((r) => setTimeout(r, 30));
      s.unsubscribe();
      req.raw._emit('close');
      return events.filter((e) => e.type !== 'connected');
    };

    it('an organisation stream receives a project event without projectId, scanId nor payload', async () => {
      const events = await collect(
        ['cybe:event:org:o:projects'],
        'cybe:event:org:o:projects',
        scanFailed,
      );
      expect(events).toEqual([
        {
          eventId: 'evt-1',
          type: 'SCAN_STATUS_CHANGED',
          timestamp: '2026-10-09T10:00:00.000Z',
          scope: { organizationId: 'o' },
        },
      ]);
    });

    it('a project stream still receives the full envelope', async () => {
      const events = await collect(
        ['cybe:event:project:p-hidden:issues'],
        'cybe:event:project:p-hidden:issues',
        scanFailed,
      );
      expect(events).toEqual([scanFailed]);
    });

    it('one stream on a project and an org channel gets each channel in its own form', async () => {
      const req = fakeReq();
      const events: any[] = [];
      const s1 = factory
        .createScopedStream({
          channels: [
            'cybe:event:project:p-hidden:issues',
            'cybe:event:org:o:overview',
          ],
          request: req,
        })
        .subscribe((m: any) => events.push(JSON.parse(m.data)));
      await new Promise((r) => setTimeout(r, 30));
      await pub.publish(
        'cybe:event:org:o:overview',
        JSON.stringify(scanFailed),
      );
      await pub.publish(
        'cybe:event:project:p-hidden:issues',
        JSON.stringify(scanFailed),
      );
      await new Promise((r) => setTimeout(r, 30));
      s1.unsubscribe();
      req.raw._emit('close');
      const scans = events.filter((e) => e.type === 'SCAN_STATUS_CHANGED');
      expect(scans).toHaveLength(2);
      expect(scans.filter((e) => e.payload === undefined)).toHaveLength(1);
      expect(scans).toContainEqual(scanFailed);
    });

    it('a type outside the allowlist with project data in its payload only reaches an org stream without payload', async () => {
      const events = await collect(
        ['cybe:event:org:o:projects'],
        'cybe:event:org:o:projects',
        {
          eventId: 'evt-4',
          type: 'PROJECT_STATE_CHANGED',
          timestamp: 't',
          scope: { organizationId: 'o' },
          payload: { projectStateChanged: { projectId: 'p-hidden' } },
        },
      );
      expect(events).toEqual([
        {
          eventId: 'evt-4',
          type: 'PROJECT_STATE_CHANGED',
          timestamp: 't',
          scope: { organizationId: 'o' },
        },
      ]);
    });

    it('a team stream keeps the team id and drops the payload of a project event', async () => {
      const events = await collect(['cybe:event:team:t'], 'cybe:event:team:t', {
        eventId: 'evt-5',
        type: 'SCAN_STATUS_CHANGED',
        timestamp: 't',
        scope: { organizationId: 'o', teamId: 't', projectId: 'p-hidden' },
        payload: { x: 'p-hidden' },
      });
      expect(events).toEqual([
        {
          eventId: 'evt-5',
          type: 'SCAN_STATUS_CHANGED',
          timestamp: 't',
          scope: { organizationId: 'o', teamId: 't' },
        },
      ]);
    });

    it('an organisation event without project scope (billing usage) passes unchanged', async () => {
      const usage = {
        eventId: 'evt-2',
        type: 'USAGE_UPDATED',
        timestamp: 't',
        scope: { organizationId: 'o' },
        payload: { usageUpdated: { organizationId: 'o', usageKind: 'scans' } },
      };
      const events = await collect(
        ['cybe:event:billing:org:o'],
        'cybe:event:billing:org:o',
        usage,
      );
      expect(events).toEqual([usage]);
    });
  });

  it('refcounts subscriptions: only one Redis subscribe per channel for N connections', async () => {
    const subscribeSpy = jest.spyOn(sub, 'subscribe');
    const unsubscribeSpy = jest.spyOn(sub, 'unsubscribe');
    const r1 = fakeReq();
    const r2 = fakeReq();
    const s1 = factory
      .createScopedStream({
        channels: ['cybe:event:org:o:projects'],
        request: r1,
      })
      .subscribe();
    const s2 = factory
      .createScopedStream({
        channels: ['cybe:event:org:o:projects'],
        request: r2,
      })
      .subscribe();
    await new Promise((r) => setTimeout(r, 30));
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    s1.unsubscribe();
    r1.raw._emit('close');
    await new Promise((r) => setTimeout(r, 30));
    expect(unsubscribeSpy).not.toHaveBeenCalled(); // refcount still 1
    s2.unsubscribe();
    r2.raw._emit('close');
    await new Promise((r) => setTimeout(r, 30));
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('registers with MembershipRegistry when membershipScope is provided', async () => {
    const req = fakeReq();
    const s = factory
      .createScopedStream({
        channels: ['cybe:event:org:o:projects'],
        membershipScope: { scopeKey: 'org:o', userId: 'u1' },
        request: req,
      })
      .subscribe();
    await new Promise((r) => setTimeout(r, 10));
    expect(registry.size()).toBe(1);
    s.unsubscribe();
    req.raw._emit('close');
    await new Promise((r) => setTimeout(r, 30));
    expect(registry.size()).toBe(0);
  });

  it('membership kick closes the stream', async () => {
    const req = fakeReq();
    const events: any[] = [];
    factory
      .createScopedStream({
        channels: ['cybe:event:org:o:projects'],
        membershipScope: { scopeKey: 'org:o', userId: 'u1' },
        request: req,
      })
      .subscribe({
        next: (m: any) => events.push(m),
        complete: () => events.push({ completed: true }),
      });
    await new Promise((r) => setTimeout(r, 30));
    registry.kick({ userId: 'u1', scopeType: 'organization', scopeId: 'o' });
    await new Promise((r) => setTimeout(r, 30));
    expect(events.find((e) => e.completed)).toBeDefined();
  });

  it('schedules auth-refresh 60s before exp', async () => {
    jest.useFakeTimers();
    const exp = Math.floor(Date.now() / 1000) + 65; // 65s from now
    const req = fakeReq(exp);
    const events: any[] = [];
    factory
      .createScopedStream({
        channels: ['cybe:event:org:o:projects'],
        request: req,
      })
      .subscribe((m: any) => events.push(m));
    jest.advanceTimersByTime(6000); // now at exp - 59s → past the 5s (65-60=5s) warn threshold
    expect(
      events.find(
        (e: any) =>
          e.event === 'auth-refresh' ||
          (e.data && e.data.includes('auth-refresh')),
      ),
    ).toBeDefined();
    jest.useRealTimers();
  });

  describe('closing a stream its caller may no longer read', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    const PROJECT_CHECKS = [
      {
        subjectType: 'project',
        subjectId: 'p1',
        permission: 'read_scan_result',
      },
    ];

    const open = (
      f: RealtimeStreamFactory,
      req: ReturnType<typeof fakeReq>,
      extra: Record<string, unknown> = {},
    ) => {
      const events: any[] = [];
      let completed = false;
      f.createScopedStream({
        channels: ['cybe:event:project:p1:issues'],
        membershipScope: { scopeKey: 'project:p1', userId: 'u1' },
        request: req,
        ...extra,
      }).subscribe({
        next: (m: any) => events.push(m),
        complete: () => {
          completed = true;
        },
      });
      return { events, isClosed: () => completed };
    };

    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };

    it('closes the stream when the token that opened it expires', () => {
      jest.useFakeTimers();
      const req = fakeReq(Math.floor(Date.now() / 1000) + 65);
      const s = open(factory, req);
      jest.advanceTimersByTime(64_000);
      expect(s.isClosed()).toBe(false);
      jest.advanceTimersByTime(2_000);
      expect(s.isClosed()).toBe(true);
    });

    it('closes a stream opened without an expiry (a personal access token) after its maximum lifetime', () => {
      expect(REALTIME_STREAM_MAX_LIFETIME_MS).toBe(15 * 60_000);
      jest.useFakeTimers();
      const s = open(factory, fakeReq());
      jest.advanceTimersByTime(REALTIME_STREAM_MAX_LIFETIME_MS - 1_000);
      expect(s.isClosed()).toBe(false);
      jest.advanceTimersByTime(2_000);
      expect(s.isClosed()).toBe(true);
    });

    it('re-checks the permission about every 60 s and closes the stream once it is denied', async () => {
      expect(REALTIME_PERMISSION_RECHECK_MS).toBe(60_000);
      jest.useFakeTimers();
      // The middle of the jitter: first check at 36 s, then every 60 s.
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      const isAllowed = jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const f = new RealtimeStreamFactory(sub as any, registry, {
        isAllowed,
      } as unknown as StreamAuthorizer);
      const s = open(f, fakeReq(), { authorization: PROJECT_CHECKS });

      expect(isAllowed).not.toHaveBeenCalled();
      jest.advanceTimersByTime(REALTIME_PERMISSION_RECHECK_MS);
      await flush();
      expect(isAllowed).toHaveBeenCalledWith('u1', PROJECT_CHECKS);
      expect(s.isClosed()).toBe(false);

      jest.advanceTimersByTime(REALTIME_PERMISSION_RECHECK_MS);
      await flush();
      expect(isAllowed).toHaveBeenCalledTimes(2);
      expect(s.isClosed()).toBe(true);
    });

    const tick = async (ms: number) => {
      jest.advanceTimersByTime(ms);
      await flush();
    };

    it('keeps the stream through a short permission engine outage, and closes it after 3 errors in a row', async () => {
      expect(REALTIME_PERMISSION_MAX_CONSECUTIVE_ERRORS).toBe(3);
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(1);
      const down = new Error('unavailable');
      const isAllowed = jest
        .fn()
        .mockRejectedValueOnce(down)
        .mockRejectedValueOnce(down)
        .mockResolvedValueOnce(true) // back: the count starts again
        .mockRejectedValueOnce(down)
        .mockRejectedValueOnce(down)
        .mockRejectedValueOnce(down);
      const f = new RealtimeStreamFactory(sub as any, registry, {
        isAllowed,
      } as unknown as StreamAuthorizer);
      const s = open(f, fakeReq(), { authorization: PROJECT_CHECKS });
      const period = REALTIME_PERMISSION_RECHECK_MS * 1.2;
      for (let i = 1; i <= 5; i++) {
        await tick(period);
        expect({ check: i, closed: s.isClosed() }).toEqual({
          check: i,
          closed: false,
        });
      }
      await tick(period);
      expect(isAllowed).toHaveBeenCalledTimes(6);
      expect(s.isClosed()).toBe(true);
    });

    it('spreads the checks: the first at a random point of the period, the next ones within 20 % of it', async () => {
      jest.useFakeTimers();
      const random = jest.spyOn(Math, 'random').mockReturnValue(0);
      const isAllowed = jest.fn().mockResolvedValue(true);
      const f = new RealtimeStreamFactory(sub as any, registry, {
        isAllowed,
      } as unknown as StreamAuthorizer);
      open(f, fakeReq(), { authorization: PROJECT_CHECKS });
      // random 0: first check at 20 % of the period, then every 80 %.
      await tick(REALTIME_PERMISSION_RECHECK_MS * 0.2 - 100);
      expect(isAllowed).toHaveBeenCalledTimes(0);
      await tick(200);
      expect(isAllowed).toHaveBeenCalledTimes(1);
      await tick(REALTIME_PERMISSION_RECHECK_MS * 0.8);
      expect(isAllowed).toHaveBeenCalledTimes(2);

      // The next delay is drawn when a check fires. With random 1 from the
      // third check on, the fourth comes 120 % of the period later.
      random.mockReturnValue(1);
      await tick(REALTIME_PERMISSION_RECHECK_MS * 0.8);
      expect(isAllowed).toHaveBeenCalledTimes(3);
      await tick(REALTIME_PERMISSION_RECHECK_MS * 1.2 - 1_000);
      expect(isAllowed).toHaveBeenCalledTimes(3);
      await tick(2_000);
      expect(isAllowed).toHaveBeenCalledTimes(4);
    });

    it('runs a check asked for during another one when that one ends', async () => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0);
      let answer: (allowed: boolean) => void = () => undefined;
      const isAllowed = jest
        .fn()
        .mockImplementationOnce(
          () => new Promise<boolean>((resolve) => (answer = resolve)),
        )
        .mockResolvedValueOnce(false);
      const f = new RealtimeStreamFactory(sub as any, registry, {
        isAllowed,
      } as unknown as StreamAuthorizer);
      const s = open(f, fakeReq(), { authorization: PROJECT_CHECKS });
      await tick(REALTIME_PERMISSION_RECHECK_MS * 0.2);
      expect(isAllowed).toHaveBeenCalledTimes(1);

      // The user is removed while the periodic check is running.
      registry.recheckUser('u1');
      answer(true); // the running check read the permissions from before
      await flush();
      expect(isAllowed).toHaveBeenCalledTimes(2);
      expect(s.isClosed()).toBe(true);
    });

    it('closes a stream at the maximum lifetime when the token expires later, without a timer overflow', async () => {
      jest.useFakeTimers();
      const thirtyDays = 30 * 24 * 3600;
      const s = open(
        factory,
        fakeReq(Math.floor(Date.now() / 1000) + thirtyDays),
      );
      await tick(1_000);
      expect(s.isClosed()).toBe(false);
      await tick(REALTIME_STREAM_MAX_LIFETIME_MS - 2_000);
      expect(s.isClosed()).toBe(false);
      await tick(2_000);
      expect(s.isClosed()).toBe(true);
    });

    it('re-checks at once on a membership change of the user, whatever its scope', async () => {
      const isAllowed = jest.fn().mockResolvedValue(false);
      const f = new RealtimeStreamFactory(sub as any, registry, {
        isAllowed,
      } as unknown as StreamAuthorizer);
      const mine = open(f, fakeReq(), { authorization: PROJECT_CHECKS });
      const otherReq = fakeReq();
      otherReq.user.sub = 'u2';
      const theirs = open(f, otherReq, {
        authorization: PROJECT_CHECKS,
        membershipScope: { scopeKey: 'project:p1', userId: 'u2' },
      });

      // Removed from a team: the project stream is not keyed on the team.
      registry.recheckUser('u1');
      await flush();
      expect(isAllowed).toHaveBeenCalledTimes(1);
      expect(isAllowed).toHaveBeenCalledWith('u1', PROJECT_CHECKS);
      expect(mine.isClosed()).toBe(true);
      expect(theirs.isClosed()).toBe(false);
      otherReq.raw._emit('close');
    });

    it('asks the permission engine nothing per event', async () => {
      const isAllowed = jest.fn().mockResolvedValue(true);
      const f = new RealtimeStreamFactory(sub as any, registry, {
        isAllowed,
      } as unknown as StreamAuthorizer);
      const req = fakeReq();
      const s = open(f, req, { authorization: PROJECT_CHECKS });
      await new Promise((r) => setTimeout(r, 30));
      for (let i = 0; i < 50; i++) {
        await pub.publish(
          'cybe:event:project:p1:issues',
          JSON.stringify({ type: 'VULNERABILITY_UPDATED', eventId: `e${i}` }),
        );
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(s.events.length).toBeGreaterThanOrEqual(50);
      expect(isAllowed).not.toHaveBeenCalled();
      req.raw._emit('close');
    });

    it('stops re-checking once the stream is closed', async () => {
      jest.useFakeTimers();
      const isAllowed = jest.fn().mockResolvedValue(true);
      const f = new RealtimeStreamFactory(sub as any, registry, {
        isAllowed,
      } as unknown as StreamAuthorizer);
      const req = fakeReq();
      open(f, req, { authorization: PROJECT_CHECKS });
      req.raw._emit('close');
      jest.advanceTimersByTime(REALTIME_PERMISSION_RECHECK_MS * 4);
      await flush();
      registry.recheckUser('u1');
      await flush();
      expect(isAllowed).not.toHaveBeenCalled();
    });
  });
});
