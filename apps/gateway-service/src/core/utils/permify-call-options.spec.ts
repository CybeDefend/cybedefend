import { status } from '@grpc/grpc-js';
import {
  DEFAULT_PERMIFY_RPC_DEADLINE_MS,
  isPermifyUnavailable,
  permifyCallOptions,
  PermifyDeadlineExceededError,
  resolvePermifyDeadlineMs,
  withPermifyDeadline,
} from './permify-call-options';

describe('permifyCallOptions', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('defaults to a 2s deadline', () => {
    expect(DEFAULT_PERMIFY_RPC_DEADLINE_MS).toBe(2000);
  });

  it('returns a signal that is not aborted before the deadline', () => {
    jest.useFakeTimers();
    const { signal } = permifyCallOptions(2000);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(1999);
    expect(signal.aborted).toBe(false);
  });

  it('also carries a grpc-js deadline for any future grpc-js call site', () => {
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    const { deadline } = permifyCallOptions(2000);
    expect(deadline).toBe(1_700_000_000_000 + 2000);
  });

  it('aborts with a DEADLINE_EXCEEDED reason once the deadline elapses', () => {
    jest.useFakeTimers();
    const { signal } = permifyCallOptions(2000);
    jest.advanceTimersByTime(2000);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(PermifyDeadlineExceededError);
    expect(signal.reason.code).toBe(status.DEADLINE_EXCEEDED);
  });

  describe('resolvePermifyDeadlineMs', () => {
    it('falls back to the default when unset or unparseable', () => {
      expect(resolvePermifyDeadlineMs(undefined)).toBe(2000);
      expect(resolvePermifyDeadlineMs(null)).toBe(2000);
      expect(resolvePermifyDeadlineMs('')).toBe(2000);
      expect(resolvePermifyDeadlineMs('not-a-number')).toBe(2000);
      expect(resolvePermifyDeadlineMs('0')).toBe(2000);
      expect(resolvePermifyDeadlineMs('-5')).toBe(2000);
    });

    it('honours a positive override', () => {
      expect(resolvePermifyDeadlineMs('300')).toBe(300);
      expect(resolvePermifyDeadlineMs(750)).toBe(750);
    });
  });

  describe('isPermifyUnavailable', () => {
    it('is true for DEADLINE_EXCEEDED and UNAVAILABLE', () => {
      expect(isPermifyUnavailable({ code: status.DEADLINE_EXCEEDED })).toBe(
        true,
      );
      expect(isPermifyUnavailable({ code: status.UNAVAILABLE })).toBe(true);
      expect(isPermifyUnavailable(new PermifyDeadlineExceededError(300))).toBe(
        true,
      );
    });

    /**
     * A bare abort carries no gRPC status. `AbortSignal.timeout()` rejects with
     * a DOMException named TimeoutError whose `code` is 23 (DOMException.
     * TIMEOUT_ERR) — checking only for `status.DEADLINE_EXCEEDED` would classify
     * a real timeout as a 500. Measured against the live SDK, not assumed.
     */
    it('is true for a bare abort, whichever way the signal was built', () => {
      const timeoutError = Object.assign(new Error('aborted due to timeout'), {
        name: 'TimeoutError',
        code: 23,
      });
      const abortError = Object.assign(new Error('aborted'), {
        name: 'AbortError',
      });
      expect(isPermifyUnavailable(timeoutError)).toBe(true);
      expect(isPermifyUnavailable(abortError)).toBe(true);
    });

    it('is false for any other error', () => {
      expect(isPermifyUnavailable({ code: status.INTERNAL })).toBe(false);
      expect(isPermifyUnavailable({ code: status.PERMISSION_DENIED })).toBe(
        false,
      );
      expect(isPermifyUnavailable(new Error('boom'))).toBe(false);
      expect(isPermifyUnavailable(undefined)).toBe(false);
      expect(isPermifyUnavailable(null)).toBe(false);
    });
  });

  /**
   * The gateway guard runs on EVERY guarded request. Leaving one armed timer
   * per check for the full 2 s would mean up to 2s x RPS live timers for
   * deadlines that have already been met, so the deadline is cancelled the
   * moment the call settles.
   */
  describe('withPermifyDeadline', () => {
    it('returns the call result and leaves no timer armed', async () => {
      jest.useFakeTimers();
      await expect(withPermifyDeadline(2000, async () => 'ok')).resolves.toBe(
        'ok',
      );
      expect(jest.getTimerCount()).toBe(0);
    });

    it('leaves no timer armed when the call rejects', async () => {
      jest.useFakeTimers();
      await expect(
        withPermifyDeadline(2000, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(jest.getTimerCount()).toBe(0);
    });

    it('aborts an in-flight call once the deadline elapses', async () => {
      jest.useFakeTimers();
      const pending = withPermifyDeadline(
        2000,
        (options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(options.signal.reason),
            );
          }),
      );
      const expectation = expect(pending).rejects.toBeInstanceOf(
        PermifyDeadlineExceededError,
      );

      await jest.advanceTimersByTimeAsync(2000);
      await expectation;
      expect(jest.getTimerCount()).toBe(0);
    });

    it('hands the call a deadline and a signal', async () => {
      jest.useFakeTimers({ now: 1_700_000_000_000 });
      const seen = await withPermifyDeadline(2000, async (options) => options);
      expect(seen.deadline).toBe(1_700_000_000_000 + 2000);
      expect(seen.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
