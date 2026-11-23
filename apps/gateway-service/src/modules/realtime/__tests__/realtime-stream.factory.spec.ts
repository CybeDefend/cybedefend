import RedisMock from 'ioredis-mock';
import { firstValueFrom } from 'rxjs';
import { MembershipRegistry } from '../membership.registry';
import { RealtimeStreamFactory } from '../realtime-stream.factory';

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
});
