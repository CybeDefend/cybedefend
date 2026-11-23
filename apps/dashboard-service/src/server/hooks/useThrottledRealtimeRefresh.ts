import { useCallback, useEffect, useRef } from 'react';

const DEFAULT_WINDOW_MS = 5_000;

export interface ThrottledRealtimeRefreshOptions {
  /**
   * Never start a fire while the previous one is still running, i.e. while the
   * promise `onTrigger` returned has not settled. A call that arrives meanwhile
   * is kept and served once it settles, still no sooner than the window allows.
   * For a request that can outlast the window (GET /user/profile, the org
   * overview aggregate): without it, the trailing fire started a second
   * request next to the first one. The wait is bounded by
   * max(window, IN_FLIGHT_MAX_WAIT_MS): a call that never settles cannot
   * swallow the events that follow it.
   */
  waitForInFlight?: boolean;
}

/**
 * The longest `waitForInFlight` waits for a call, or the window when it is
 * longer. gatewayAPI sets no timeout, and a request held by a dead connection
 * can hang for minutes: past this bound the call is abandoned
 * (its answer still lands, it no longer holds the next fire back).
 */
export const IN_FLIGHT_MAX_WAIT_MS = 30_000;

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === 'function';

/**
 * Leading + trailing edge throttle for realtime-event-driven refetches.
 *
 * Bursts of SSE events (AGENT_STEP_CHANGED across vulns, scanner finishing,
 * VULNERABILITY_BATCH_APPENDED batches, etc.) arrive in clusters of 3–5
 * within < 1 s. Without throttling, every consumer hook fires its own
 * GET in tight loops, multiplied by the number of hooks mounted on the
 * page. This helper bounds each consumer to at most one leading fire +
 * one trailing fire per window, regardless of how many events arrive.
 *
 * The trailing fire always invokes the LATEST callback identity (via ref)
 * so swapping props between schedule and fire is safe. Pending trailing
 * timers are cleared when `resetKey` changes (page switch, scan switch)
 * and on unmount so the callback can never run against a torn-down
 * context.
 *
 * Returns a dispatch function that the consumer wires into its
 * useRealtimeStream handlers. The dispatch is stable across re-renders.
 */
export function useThrottledRealtimeRefresh(
  onTrigger: () => void | PromiseLike<unknown>,
  resetKey: string | undefined,
  windowMs: number = DEFAULT_WINDOW_MS,
  options: ThrottledRealtimeRefreshOptions = {},
): () => void {
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;
  const waitForInFlight = options.waitForInFlight === true;

  const lastFireAtRef = useRef(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPendingRef = useRef(false);
  // Id of the call the next fire waits for, 0 when none. Only that call can
  // release the wait, through its settlement or its bound: a call abandoned
  // at its bound, or fired for a previous scope (the id is reset on a scope
  // change and on unmount), releases nothing when it settles later.
  const inFlightCallRef = useRef(0);
  const callSeqRef = useRef(0);
  const inFlightBoundRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Reset throttle state when the consumer's scope (project, scan, vuln)
    // changes — otherwise a trailing fire scheduled for the old scope would
    // run against the new one and refetch the wrong resource.
    lastFireAtRef.current = 0;
    hasPendingRef.current = false;
    inFlightCallRef.current = 0;
    return () => {
      if (trailingTimerRef.current) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
      if (inFlightBoundRef.current) {
        clearTimeout(inFlightBoundRef.current);
        inFlightBoundRef.current = null;
      }
      hasPendingRef.current = false;
      inFlightCallRef.current = 0;
    };
  }, [resetKey]);

  const dispatchRef = useRef<() => void>(() => undefined);

  const fire = useCallback(() => {
    lastFireAtRef.current = Date.now();
    hasPendingRef.current = false;
    const result = onTriggerRef.current();
    if (!waitForInFlight || !isPromiseLike(result)) return;
    const callId = ++callSeqRef.current;
    inFlightCallRef.current = callId;
    // Settlement or bound, whichever comes first, releases the wait once.
    const release = () => {
      if (inFlightCallRef.current !== callId) return;
      inFlightCallRef.current = 0;
      if (inFlightBoundRef.current) {
        clearTimeout(inFlightBoundRef.current);
        inFlightBoundRef.current = null;
      }
      if (hasPendingRef.current) dispatchRef.current();
    };
    inFlightBoundRef.current = setTimeout(
      release,
      Math.max(windowMs, IN_FLIGHT_MAX_WAIT_MS),
    );
    result.then(release, release);
  }, [waitForInFlight, windowMs]);

  const dispatch = useCallback(() => {
    if (inFlightCallRef.current) {
      // Served by the settlement (or the bound) of the running call.
      hasPendingRef.current = true;
      return;
    }
    const now = Date.now();
    const elapsed = now - lastFireAtRef.current;
    if (elapsed >= windowMs) {
      fire();
      return;
    }
    hasPendingRef.current = true;
    if (trailingTimerRef.current) return;
    trailingTimerRef.current = setTimeout(() => {
      trailingTimerRef.current = null;
      if (!hasPendingRef.current) return;
      // Still running: its settlement (or bound) serves the pending call.
      if (inFlightCallRef.current) return;
      fire();
    }, windowMs - elapsed);
  }, [windowMs, fire]);
  dispatchRef.current = dispatch;

  return dispatch;
}

export default useThrottledRealtimeRefresh;
