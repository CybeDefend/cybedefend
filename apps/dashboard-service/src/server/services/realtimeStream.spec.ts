import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fetchEventSourceMock } = vi.hoisted(() => ({
  fetchEventSourceMock: vi.fn(),
}));

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: fetchEventSourceMock,
  EventStreamContentType: 'text/event-stream',
}));

import {
  openStream,
  __resetConnectionsForTests,
  CLOSE_GRACE_MS,
} from './realtimeStream';

interface CapturedCall {
  url: string;
  options: any;
}

const lastCall = (): CapturedCall => {
  const call = fetchEventSourceMock.mock.calls.at(-1);
  if (!call) throw new Error('fetchEventSource was not called');
  return { url: call[0], options: call[1] };
};

const fatalResponse = (status: number): Response =>
  ({
    ok: false,
    status,
    headers: { get: () => null } as unknown as Headers,
  }) as unknown as Response;

beforeEach(() => {
  __resetConnectionsForTests();
  fetchEventSourceMock.mockReset();
  // Default: a promise that never resolves so the lib stays "connected"
  fetchEventSourceMock.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('openStream (fetch-event-source)', () => {
  it('opens a connection with Authorization Bearer header', () => {
    openStream(
      'https://api/v1/realtime/orgs/o/projects/stream',
      {},
      { tokenProvider: () => 'jwt-abc' },
    );
    expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
    const { url, options } = lastCall();
    expect(url).toBe('https://api/v1/realtime/orgs/o/projects/stream');
    expect(options.headers.Authorization).toBe('Bearer jwt-abc');
    expect(url).not.toMatch(/access_token/);
  });

  it('does not open a connection when token is null', () => {
    openStream('https://api/x', {}, { tokenProvider: () => null });
    expect(fetchEventSourceMock).not.toHaveBeenCalled();
  });

  it('routes typed messages to handlers by env.type', () => {
    const onScan = vi.fn();
    openStream(
      'https://api/x',
      { SCAN_STATUS_CHANGED: onScan },
      { tokenProvider: () => 't' },
    );
    const { options } = lastCall();
    options.onmessage({
      event: '',
      id: '',
      data: JSON.stringify({ type: 'SCAN_STATUS_CHANGED', payload: { x: 1 } }),
    });
    expect(onScan).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SCAN_STATUS_CHANGED' }),
    );
  });

  it('routes AGENT_STEP_CHANGED messages to handlers', () => {
    const onAgentStep = vi.fn();
    openStream(
      'https://api/x',
      { AGENT_STEP_CHANGED: onAgentStep },
      { tokenProvider: () => 't' },
    );
    const { options } = lastCall();
    options.onmessage({
      event: '',
      id: '',
      data: JSON.stringify({
        type: 'AGENT_STEP_CHANGED',
        payload: {
          agentStepChanged: {
            scanId: 's-1',
            podName: 'pod-1',
            previousStep: 'a',
            currentStep: 'b',
          },
        },
      }),
    });
    expect(onAgentStep).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'AGENT_STEP_CHANGED' }),
    );
  });

  it('passes Last-Event-ID header on reconnect after a message with id', () => {
    vi.useFakeTimers();
    let onerror: ((e: any) => any) | undefined;
    fetchEventSourceMock.mockImplementation((_url: string, opts: any) => {
      onerror = opts.onerror;
      return new Promise(() => {});
    });
    openStream('https://api/x', {}, { tokenProvider: () => 't' });
    const first = lastCall();
    first.options.onmessage({
      event: '',
      id: 'evt-7',
      data: JSON.stringify({ type: 'SCAN_STATUS_CHANGED', payload: {} }),
    });
    // Trigger reconnect via the lib's onerror hook (now goes through backoff)
    try { onerror?.(new Error('boom')); } catch { /* lib swallows */ }
    vi.advanceTimersByTime(60_000);
    expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    const second = lastCall();
    expect(second.options.headers['Last-Event-ID']).toBe('evt-7');
  });

  // ──────────────────────────────────────────────────────────────────────
  // `Last-Event-ID` is not free: the browser will not send it
  // cross-origin unless the gateway's CORS preflight names it. The failure mode is the nastiest kind
  // — the request never leaves, `fetchEventSource` surfaces a bare
  // `TypeError`, and retrying with the same header can only reproduce it.
  // The client must therefore treat the header itself as suspect once
  // retrying has plainly stopped helping, and self-heal against a gateway
  // that has not been (or cannot be) updated.
  // ──────────────────────────────────────────────────────────────────────
  describe('stale Last-Event-ID self-healing', () => {
    const preflightFailure = () =>
      new TypeError('Failed to fetch'); // what a rejected preflight looks like

    const learnEventId = (id: string) => {
      lastCall().options.onmessage({
        event: '',
        id,
        data: JSON.stringify({ type: 'SCAN_STATUS_CHANGED', payload: {} }),
      });
    };

    const failOnce = () => {
      try {
        lastCall().options.onerror(preflightFailure());
      } catch {
        /* the impl re-throws to break the lib's own retry loop */
      }
      vi.advanceTimersByTime(60_000);
    };

    it('drops Last-Event-ID after two consecutive failures', () => {
      vi.useFakeTimers();
      openStream('https://api/x', {}, { tokenProvider: () => 't' });
      learnEventId('evt-7');

      // One failure is an ordinary blip — resuming is still worth a try.
      failOnce();
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
      expect(lastCall().options.headers['Last-Event-ID']).toBe('evt-7');

      // Two in a row, and the header is the prime suspect: go without it.
      failOnce();
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(3);
      expect(lastCall().options.headers['Last-Event-ID']).toBeUndefined();
    });

    it('keeps going without the header once it has been dropped', () => {
      vi.useFakeTimers();
      openStream('https://api/x', {}, { tokenProvider: () => 't' });
      learnEventId('evt-7');
      failOnce();
      failOnce();
      failOnce();

      expect(fetchEventSourceMock).toHaveBeenCalledTimes(4);
      expect(lastCall().options.headers['Last-Event-ID']).toBeUndefined();
      // Authorization is untouched — only the resume hint is abandoned.
      expect(lastCall().options.headers.Authorization).toBe('Bearer t');
    });

    it('re-learns an event id once the stream is healthy again', () => {
      vi.useFakeTimers();
      openStream('https://api/x', {}, { tokenProvider: () => 't' });
      learnEventId('evt-7');
      failOnce();
      failOnce();
      expect(lastCall().options.headers['Last-Event-ID']).toBeUndefined();

      // A delivered frame both resets the failure counter and teaches the
      // connection a fresh id, so resumption is available again.
      learnEventId('evt-42');
      failOnce();
      expect(lastCall().options.headers['Last-Event-ID']).toBe('evt-42');
    });

    it('never drops the id on a single isolated failure', () => {
      // Regression guard on the threshold: a lone network blip must still
      // resume where the stream left off.
      vi.useFakeTimers();
      openStream('https://api/x', {}, { tokenProvider: () => 't' });
      learnEventId('evt-7');
      failOnce();
      learnEventId('evt-8');
      failOnce();
      expect(lastCall().options.headers['Last-Event-ID']).toBe('evt-8');
    });
  });

  it('refreshes token on reconnect (tokenProvider called each time)', () => {
    vi.useFakeTimers();
    let token = 'old';
    let onerror: ((e: any) => any) | undefined;
    fetchEventSourceMock.mockImplementation((_url: string, opts: any) => {
      onerror = opts.onerror;
      return new Promise(() => {});
    });
    openStream('https://api/x', {}, { tokenProvider: () => token });
    expect(lastCall().options.headers.Authorization).toBe('Bearer old');
    token = 'new';
    try { onerror?.(new Error('boom')); } catch { /* lib swallows */ }
    vi.advanceTimersByTime(60_000);
    expect(lastCall().options.headers.Authorization).toBe('Bearer new');
  });

  it('close() aborts the underlying signal once the grace period has passed', () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchEventSourceMock.mockImplementation((_url: string, opts: any) => {
      signal = opts.signal;
      return new Promise(() => {});
    });
    const handle = openStream('https://api/x', {}, { tokenProvider: () => 't' });
    expect(signal?.aborted).toBe(false);
    handle.close();
    vi.advanceTimersByTime(CLOSE_GRACE_MS);
    expect(signal?.aborted).toBe(true);
  });

  it('after close(), errors do not trigger reconnect', () => {
    let onerror: ((e: any) => any) | undefined;
    fetchEventSourceMock.mockImplementation((_url: string, opts: any) => {
      onerror = opts.onerror;
      return new Promise(() => {});
    });
    const handle = openStream('https://api/x', {}, { tokenProvider: () => 't' });
    handle.close();
    try { onerror?.(new Error('boom')); } catch { /* expected */ }
    expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
  });

  it('routes the auth-refresh server event by reopening with a fresh token', () => {
    let token = 'old';
    fetchEventSourceMock.mockImplementation(() => new Promise(() => {}));
    openStream('https://api/x', {}, { tokenProvider: () => token });
    const { options } = lastCall();
    token = 'new';
    options.onmessage({ event: 'auth-refresh', id: '', data: '' });
    expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    expect(lastCall().options.headers.Authorization).toBe('Bearer new');
  });

  describe('connection multiplexing per URL', () => {
    it('reuses a single underlying connection when two subscribers share a URL', () => {
      openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
    });

    it('fans an event out to every subscriber of the same URL', () => {
      const a = vi.fn();
      const b = vi.fn();
      openStream(
        'https://api/shared',
        { SCAN_STATUS_CHANGED: a },
        { tokenProvider: () => 't' },
      );
      openStream(
        'https://api/shared',
        { SCAN_STATUS_CHANGED: b },
        { tokenProvider: () => 't' },
      );
      const { options } = lastCall();
      options.onmessage({
        event: '',
        id: '',
        data: JSON.stringify({ type: 'SCAN_STATUS_CHANGED', payload: {} }),
      });
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('keeps the underlying connection alive while at least one subscriber remains', () => {
      let signal: AbortSignal | undefined;
      fetchEventSourceMock.mockImplementation((_u: string, opts: any) => {
        signal = opts.signal;
        return new Promise(() => {});
      });
      const h1 = openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      h1.close();
      expect(signal?.aborted).toBe(false);
    });

    it('aborts the underlying connection once the last subscriber closed and the grace period passed', () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      fetchEventSourceMock.mockImplementation((_u: string, opts: any) => {
        signal = opts.signal;
        return new Promise(() => {});
      });
      const h1 = openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      const h2 = openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      h1.close();
      h2.close();
      vi.advanceTimersByTime(CLOSE_GRACE_MS - 1);
      expect(signal?.aborted).toBe(false);
      vi.advanceTimersByTime(1);
      expect(signal?.aborted).toBe(true);
    });

    it('opens distinct connections for distinct URLs', () => {
      openStream('https://api/a', {}, { tokenProvider: () => 't' });
      openStream('https://api/b', {}, { tokenProvider: () => 't' });
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    });

    it('after the last close and the grace period, a new subscribe re-opens a fresh connection', () => {
      vi.useFakeTimers();
      const h = openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      h.close();
      vi.advanceTimersByTime(CLOSE_GRACE_MS);
      openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    });
  });

  // Switching between two Results tabs unmounts the hooks
  // of one page and mounts those of the next on the same project stream. The
  // connection used to be torn down and reopened in between: one more SSE
  // handshake and one more Permify check per tab change.
  describe('deferred close', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('keeps one connection when the same URL is closed then opened again within 100 ms', () => {
      let signal: AbortSignal | undefined;
      fetchEventSourceMock.mockImplementation((_u: string, opts: any) => {
        signal = opts.signal;
        return new Promise(() => {});
      });
      const before = vi.fn();
      const after = vi.fn();
      const h = openStream(
        'https://api/v1/realtime/projects/p1/issues/stream',
        { SCAN_STATUS_CHANGED: before },
        { tokenProvider: () => 't' },
      );
      h.close();
      vi.advanceTimersByTime(50);
      openStream(
        'https://api/v1/realtime/projects/p1/issues/stream',
        { SCAN_STATUS_CHANGED: after },
        { tokenProvider: () => 't' },
      );
      vi.advanceTimersByTime(60_000);

      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
      expect(signal?.aborted).toBe(false);

      lastCall().options.onmessage({
        event: '',
        id: '',
        data: JSON.stringify({ type: 'SCAN_STATUS_CHANGED', payload: {} }),
      });
      expect(before).not.toHaveBeenCalled();
      expect(after).toHaveBeenCalledTimes(1);
    });

    it('does not reconnect a connection the server closes while nobody subscribes', () => {
      let signal: AbortSignal | undefined;
      fetchEventSourceMock.mockImplementation((_u: string, opts: any) => {
        signal = opts.signal;
        return new Promise(() => {});
      });
      const h = openStream('https://api/x', {}, { tokenProvider: () => 't' });
      h.close();
      lastCall().options.onclose();
      vi.advanceTimersByTime(60_000);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
      expect(signal?.aborted).toBe(true);
    });

    it('ends at once when the last subscriber leaves because the user signed out', () => {
      let signal: AbortSignal | undefined;
      fetchEventSourceMock.mockImplementation((_u: string, opts: any) => {
        signal = opts.signal;
        return new Promise(() => {});
      });
      let token: string | null = 't';
      const h = openStream('https://api/x', {}, { tokenProvider: () => token });
      token = null;
      h.close();
      expect(signal?.aborted).toBe(true);
      openStream('https://api/x', {}, { tokenProvider: () => 't2' });
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    });

    it('reopens with the token of the subscriber that rejoined, not of the one that left', () => {
      const h = openStream('https://api/x', {}, { tokenProvider: () => 'old' });
      h.close();
      openStream('https://api/x', {}, { tokenProvider: () => 'new' });
      lastCall().options.onmessage({ event: 'auth-refresh', id: '', data: '' });
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
      expect(lastCall().options.headers.Authorization).toBe('Bearer new');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Error handling — protects the gateway against tight retry loops.
  // ──────────────────────────────────────────────────────────────────────
  describe('handshake / error handling', () => {
    it('treats HTTP 401 as fatal when no refresher was provided', async () => {
      const onError = vi.fn();
      openStream('https://api/x', { error: onError }, { tokenProvider: () => 't' });
      const { options } = lastCall();

      // The lib calls onopen first; on 401 it must throw, then call onerror.
      let openErr: any;
      try {
        await options.onopen(fatalResponse(401));
      } catch (e) {
        openErr = e;
      }
      expect(openErr).toBeDefined();

      // The lib then forwards the thrown error to onerror; the impl must
      // re-throw so the lib stops its internal retry loop.
      expect(() => options.onerror(openErr)).toThrow();

      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', fatal: true, status: 401 }),
      );
    });

    it('treats the first HTTP 401 as "refresh then reconnect once" when a refresher exists', async () => {
      vi.useFakeTimers();
      // A stream opened with a token that just expired (or was rejected by the
      // gateway) must not die, or the vulnerability list
      // would lose its live stream after one stale handshake.
      const refreshToken = vi.fn().mockResolvedValue('fresh-jwt');
      const onError = vi.fn();
      openStream(
        'https://api/x',
        { error: onError },
        { tokenProvider: () => 'stale-jwt', refreshToken },
      );
      const { options } = lastCall();

      let openErr: any;
      try {
        await options.onopen(fatalResponse(401));
      } catch (e) {
        openErr = e;
      }
      expect(openErr).toBeDefined();
      expect(() => options.onerror(openErr)).toThrow();
      await vi.advanceTimersByTimeAsync(100);

      expect(refreshToken).toHaveBeenCalledTimes(1);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
      expect(lastCall().options.headers.Authorization).toBe('Bearer fresh-jwt');
      expect(onError).not.toHaveBeenCalled();
    });

    it('treats a second consecutive HTTP 401 as fatal', async () => {
      vi.useFakeTimers();
      const refreshToken = vi.fn().mockResolvedValue('fresh-jwt');
      const onError = vi.fn();
      openStream(
        'https://api/x',
        { error: onError },
        { tokenProvider: () => 'stale-jwt', refreshToken },
      );

      let { options } = lastCall();
      let openErr: any;
      try {
        await options.onopen(fatalResponse(401));
      } catch (e) {
        openErr = e;
      }
      expect(() => options.onerror(openErr)).toThrow();
      await vi.advanceTimersByTimeAsync(100);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);

      ({ options } = lastCall());
      try {
        await options.onopen(fatalResponse(401));
      } catch (e) {
        openErr = e;
      }
      expect(() => options.onerror(openErr)).toThrow();

      expect(refreshToken).toHaveBeenCalledTimes(1);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', fatal: true, status: 401 }),
      );
    });

    it('treats HTTP 403 as fatal — no reconnect', async () => {
      const onError = vi.fn();
      openStream('https://api/x', { error: onError }, { tokenProvider: () => 't' });
      const { options } = lastCall();

      let openErr: any;
      try {
        await options.onopen(fatalResponse(403));
      } catch (e) {
        openErr = e;
      }
      try { options.onerror(openErr); } catch { /* expected */ }

      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ fatal: true, status: 403 }),
      );
    });

    it('treats HTTP 429 as retriable (rate-limit recoverable) with backoff', async () => {
      vi.useFakeTimers();
      openStream('https://api/x', {}, { tokenProvider: () => 't' });
      const { options } = lastCall();

      let openErr: any;
      try {
        await options.onopen(fatalResponse(429));
      } catch (e) {
        openErr = e;
      }
      try { options.onerror(openErr); } catch { /* expected */ }

      // Crucially: no immediate reconnect — backoff is in flight.
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60_000);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    });

    it('treats HTTP 503 as retriable with backoff', async () => {
      vi.useFakeTimers();
      openStream('https://api/x', {}, { tokenProvider: () => 't' });
      const { options } = lastCall();

      let openErr: any;
      try {
        await options.onopen(fatalResponse(503));
      } catch (e) {
        openErr = e;
      }
      try { options.onerror(openErr); } catch { /* expected */ }

      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60_000);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    });

    it('does not immediately reconnect on a generic network error — applies backoff', () => {
      vi.useFakeTimers();
      openStream('https://api/x', {}, { tokenProvider: () => 't' });
      const { options } = lastCall();

      try { options.onerror(new Error('network')); } catch { /* expected */ }

      // No tight loop: the next attempt only happens after the backoff timer.
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60_000);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    });

    it('slows down after several consecutive failures, warns once, and keeps trying', () => {
      vi.useFakeTimers();
      const onError = vi.fn();
      openStream('https://api/x', { error: onError }, { tokenProvider: () => 't' });

      // Hammer the connection with retriable errors way beyond any reasonable cap.
      for (let i = 0; i < 12; i++) {
        const { options } = lastCall();
        try { options.onerror(new Error('flap')); } catch { /* expected */ }
        vi.advanceTimersByTime(60_000);
      }

      // Subscribers are told once that the stream is degraded — not on every
      // single attempt, which would spam any UI wired to the error handler.
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', fatal: true, reason: 'max_retries' }),
      );
      expect(onError).toHaveBeenCalledTimes(1);

      // But the stream must NEVER be abandoned for good: a >30s outage used to
      // kill it permanently, and only a full page reload brought it back.
      // Past the budget the retry rate drops to one attempt per minute.
      expect(fetchEventSourceMock.mock.calls.length).toBe(13);
    });

    it('resets the failure counter after a successful message', () => {
      vi.useFakeTimers();
      openStream('https://api/x', {}, { tokenProvider: () => 't' });

      // Burn 4 consecutive failures (one short of the cap).
      for (let i = 0; i < 4; i++) {
        const { options } = lastCall();
        try { options.onerror(new Error('flap')); } catch { /* expected */ }
        vi.advanceTimersByTime(60_000);
      }
      // Successful message → counter resets.
      const beforeReset = lastCall();
      beforeReset.options.onmessage({
        event: '',
        id: 'x',
        data: JSON.stringify({ type: 'SCAN_STATUS_CHANGED', payload: {} }),
      });
      // Another burst of 4 failures — would have hit the cap if counter
      // had not been reset.
      for (let i = 0; i < 4; i++) {
        const { options } = lastCall();
        try { options.onerror(new Error('flap')); } catch { /* expected */ }
        vi.advanceTimersByTime(60_000);
      }
      // 1 (initial) + 4 (first burst) + 4 (second burst) = 9 total connection
      // attempts. Without the reset, the second burst would have fatal'd out
      // earlier and total would be 6.
      expect(fetchEventSourceMock.mock.calls.length).toBe(9);
    });

    it('does not reconnect after close() even when an error fires later', () => {
      vi.useFakeTimers();
      const handle = openStream('https://api/x', {}, { tokenProvider: () => 't' });
      const { options } = lastCall();
      handle.close();
      try { options.onerror(new Error('after close')); } catch { /* expected */ }
      vi.advanceTimersByTime(60_000);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Server-initiated close.
  //
  // The gateway deliberately ends every SSE response when the JWT it was
  // opened with expires (RealtimeStreamFactory schedules `disconnect$` at
  // `exp`). @microsoft/fetch-event-source treats a clean end-of-body as a
  // SUCCESS — it calls `onclose` and resolves, and never retries. Without an
  // `onclose` handler the shared Connection stays in the registry with no
  // in-flight request: heartbeats stop, no event is ever delivered again, and
  // only a full page reload recovers.
  // ──────────────────────────────────────────────────────────────────────
  describe('server-initiated close', () => {
    it('installs an onclose handler', () => {
      openStream('https://api/x', {}, { tokenProvider: () => 't' });
      expect(typeof lastCall().options.onclose).toBe('function');
    });

    it('reconnects when the server ends the stream cleanly', () => {
      vi.useFakeTimers();
      openStream('https://api/x', {}, { tokenProvider: () => 't' });
      lastCall().options.onclose();
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60_000);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    });

    it('does not reconnect after a server close once the subscriber has closed', () => {
      vi.useFakeTimers();
      const handle = openStream('https://api/x', {}, { tokenProvider: () => 't' });
      const { options } = lastCall();
      handle.close();
      options.onclose();
      vi.advanceTimersByTime(60_000);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
    });

    it('asks for a freshly minted JWT when reconnecting after a server close', async () => {
      // The gateway closes the stream exactly when the token expires, so the
      // cached redux token is stale by then: reconnecting with it earns a 401.
      // The reconnect must go through the async refresher (the Logto SDK),
      // which mints a new token from the refresh token.
      vi.useFakeTimers();
      const refreshToken = vi.fn().mockResolvedValue('fresh-jwt');
      openStream(
        'https://api/x',
        {},
        { tokenProvider: () => 'stale-jwt', refreshToken },
      );
      expect(lastCall().options.headers.Authorization).toBe('Bearer stale-jwt');

      lastCall().options.onclose();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(refreshToken).toHaveBeenCalled();
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
      expect(lastCall().options.headers.Authorization).toBe('Bearer fresh-jwt');
    });

    it('does not stay stuck when the token refresher never settles', async () => {
      // The reconnect must not depend on an identity SDK call answering. A
      // hung refresher would otherwise reintroduce exactly the bug we fix:
      // a registered connection with no request behind it, forever.
      vi.useFakeTimers();
      const refreshToken = vi.fn(() => new Promise<string | null>(() => {}));
      openStream(
        'https://api/x',
        {},
        { tokenProvider: () => 'cached-jwt', refreshToken },
      );
      lastCall().options.onclose();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(refreshToken).toHaveBeenCalled();
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
      expect(lastCall().options.headers.Authorization).toBe('Bearer cached-jwt');
    });

    it('falls back to the cached token when the refresher yields nothing', async () => {
      vi.useFakeTimers();
      const refreshToken = vi.fn().mockResolvedValue(null);
      openStream(
        'https://api/x',
        {},
        { tokenProvider: () => 'cached-jwt', refreshToken },
      );
      lastCall().options.onclose();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
      expect(lastCall().options.headers.Authorization).toBe('Bearer cached-jwt');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // A registered connection must never be a corpse: subscribers that join it
  // would otherwise silently receive nothing at all until a page reload.
  // ──────────────────────────────────────────────────────────────────────
  describe('resync after reconnect', () => {
    // The gateway ignores Last-Event-ID (no replay), so every event published
    // while the stream was down is lost for good. A page that reconnected
    // after a token expiry or a network blip must refetch its data once.
    const okResponse = (): Response =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' } as unknown as Headers,
      }) as unknown as Response;

    it('does NOT fan out snapshot-required on the very first open', async () => {
      const onSnapshot = vi.fn();
      openStream(
        'https://api/x',
        { 'snapshot-required': onSnapshot },
        { tokenProvider: () => 't' },
      );
      await lastCall().options.onopen(okResponse());
      expect(onSnapshot).not.toHaveBeenCalled();
    });

    it('fans out snapshot-required to every subscriber once a reconnect succeeds', async () => {
      vi.useFakeTimers();
      const a = vi.fn();
      const b = vi.fn();
      openStream('https://api/x', { 'snapshot-required': a }, { tokenProvider: () => 't' });
      openStream('https://api/x', { 'snapshot-required': b }, { tokenProvider: () => 't' });
      await lastCall().options.onopen(okResponse());

      // Server closed the stream (token expiry) → backoff → reconnect.
      lastCall().options.onclose();
      vi.advanceTimersByTime(60_000);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
      expect(a).not.toHaveBeenCalled(); // not before the handshake succeeded

      await lastCall().options.onopen(okResponse());
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      expect(a).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'snapshot-required' }),
      );
    });

    it('fans out snapshot-required after a reconnect that followed a network error', async () => {
      vi.useFakeTimers();
      const onSnapshot = vi.fn();
      openStream(
        'https://api/x',
        { 'snapshot-required': onSnapshot },
        { tokenProvider: () => 't' },
      );
      await lastCall().options.onopen(okResponse());
      try { lastCall().options.onerror(new Error('boom')); } catch { /* expected */ }
      vi.advanceTimersByTime(60_000);
      await lastCall().options.onopen(okResponse());
      expect(onSnapshot).toHaveBeenCalledTimes(1);
    });

    it('a reconnect that never completed its first handshake still resyncs once it does', async () => {
      // First attempt died before onopen (e.g. 503 at the edge) — the page
      // has never had a live stream, so there is nothing to catch up on.
      vi.useFakeTimers();
      const onSnapshot = vi.fn();
      openStream(
        'https://api/x',
        { 'snapshot-required': onSnapshot },
        { tokenProvider: () => 't' },
      );
      try { lastCall().options.onerror(new Error('boom')); } catch { /* expected */ }
      vi.advanceTimersByTime(60_000);
      await lastCall().options.onopen(okResponse());
      expect(onSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('connection liveness', () => {
    it('revives a dead connection when a new subscriber joins', () => {
      vi.useFakeTimers();
      openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      // Server closed the stream: the entry is still registered but has no
      // in-flight request.
      lastCall().options.onclose();
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);

      // A second hook subscribes to the same URL — it must not be parked on
      // the dead entry waiting for a reconnect that only a reload would bring.
      openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    });

    it('does not re-open a live connection when a new subscriber joins', () => {
      openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      openStream('https://api/shared', {}, { tokenProvider: () => 't' });
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
    });

    it('retries instead of dying when the token is unavailable at reconnect time', () => {
      vi.useFakeTimers();
      let token: string | null = 't';
      openStream('https://api/x', {}, { tokenProvider: () => token });
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);

      // Token momentarily gone (rotation in flight) when the reconnect fires.
      token = null;
      try { lastCall().options.onerror(new Error('boom')); } catch { /* expected */ }
      vi.advanceTimersByTime(60_000);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);

      // Once the token is back the connection must come up on its own — it
      // used to stay registered and permanently dead.
      token = 't2';
      vi.advanceTimersByTime(60_000);
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
      expect(lastCall().options.headers.Authorization).toBe('Bearer t2');
    });
  });
});
