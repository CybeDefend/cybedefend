import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

/**
 * The Community Edition asks the gateway once per page load whether this
 * instance runs scans on a connected Kubernetes cluster
 * (`GET /instance/capabilities` → `{ clusterScans }`). It drives « Start scan »,
 * the Scanning tab and « scan on every commit ». Anything that
 * cannot be read is « not enabled »: the instance is import-only, never an
 * error page. The cloud always runs scans and never asks.
 */

const mocks = vi.hoisted(() => ({
  edition: 'cloud' as string,
  get: vi.fn(),
}));

vi.mock('@/edition/edition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/edition')>();
  return {
    ...actual,
    get EDITION() {
      return mocks.edition;
    },
  };
});

vi.mock('@/server/api/gatewayAPI', () => ({
  default: { get: mocks.get },
}));

import {
  fetchInstanceCapabilities,
  resetInstanceCapabilities,
  useScansRun,
} from './instanceCapabilities';

/** A promise the test settles itself, to observe the hook while the request is in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  resetInstanceCapabilities();
  mocks.get.mockReset();
  mocks.edition = 'cloud';
});

describe('useScansRun', () => {
  it('cloud: true, no request', () => {
    mocks.edition = 'cloud';
    const { result } = renderHook(() => useScansRun());
    expect(result.current).toBe(true);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('enterprise: true, no request', () => {
    mocks.edition = 'enterprise';
    const { result } = renderHook(() => useScansRun());
    expect(result.current).toBe(true);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('community: false while loading, then the answer', async () => {
    mocks.edition = 'community';
    const pending = deferred<{ data: unknown }>();
    mocks.get.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useScansRun());
    expect(result.current).toBe(false);
    expect(mocks.get).toHaveBeenCalledWith('/instance/capabilities');

    await act(async () => {
      pending.resolve({ data: { clusterScans: true } });
      await pending.promise;
    });
    expect(result.current).toBe(true);
  });

  it('community: an answer saying clusterScans false stays false', async () => {
    mocks.edition = 'community';
    mocks.get.mockResolvedValue({ data: { clusterScans: false } });
    const { result } = renderHook(() => useScansRun());
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    await act(async () => {
      await fetchInstanceCapabilities();
    });
    expect(result.current).toBe(false);
  });

  it('two hooks: one request', async () => {
    mocks.edition = 'community';
    mocks.get.mockResolvedValue({ data: { clusterScans: true } });

    const first = renderHook(() => useScansRun());
    const second = renderHook(() => useScansRun());
    await waitFor(() => expect(first.result.current).toBe(true));
    await waitFor(() => expect(second.result.current).toBe(true));

    // A hook mounted once the answer is known reads it at once, with no new request.
    const late = renderHook(() => useScansRun());
    expect(late.result.current).toBe(true);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('a 500: false, then a later mount uses the next successful answer', async () => {
    mocks.edition = 'community';
    mocks.get.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 500'), {
        isAxiosError: true,
        response: { status: 500, data: { message: 'boom' } },
      }),
    );
    mocks.get.mockResolvedValueOnce({ data: { clusterScans: true } });
    const first = renderHook(() => useScansRun());
    await act(async () => {
      await fetchInstanceCapabilities();
    });
    expect(first.result.current).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(1);

    // The failure is not cached: a later mount asks again and its answer is used,
    // by the new hook and by the one already mounted.
    const late = renderHook(() => useScansRun());
    await waitFor(() => expect(late.result.current).toBe(true));
    await waitFor(() => expect(first.result.current).toBe(true));
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('a network error: false, then a later mount uses the next successful answer', async () => {
    mocks.edition = 'community';
    mocks.get.mockRejectedValueOnce(new Error('Network Error'));
    mocks.get.mockResolvedValueOnce({ data: { clusterScans: true } });
    const first = renderHook(() => useScansRun());
    await act(async () => {
      await fetchInstanceCapabilities();
    });
    expect(first.result.current).toBe(false);

    const late = renderHook(() => useScansRun());
    await waitFor(() => expect(late.result.current).toBe(true));
    expect(first.result.current).toBe(true);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('a 401 before sign-in is not cached as false', async () => {
    mocks.edition = 'community';
    mocks.get.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 401'), {
        isAxiosError: true,
        response: { status: 401 },
      }),
    );
    mocks.get.mockResolvedValueOnce({ data: { clusterScans: true } });
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: false });
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: true });
  });

  it('a successful answer is kept: no new request on a later mount', async () => {
    mocks.edition = 'community';
    mocks.get.mockResolvedValue({ data: { clusterScans: false } });
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: false });
    const late = renderHook(() => useScansRun());
    await act(async () => {
      await fetchInstanceCapabilities();
    });
    expect(late.result.current).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});

describe('useScansRun when the read itself throws', () => {
  it('leaves no rejection unhandled and stays false', async () => {
    mocks.edition = 'community';
    // An answer whose body cannot be read makes the shared read reject.
    mocks.get.mockResolvedValue({
      get data(): unknown {
        throw new Error('unreadable');
      },
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { result } = renderHook(() => useScansRun());
      await act(async () => {
        await fetchInstanceCapabilities().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(result.current).toBe(false);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('fetchInstanceCapabilities', () => {
  it('shares one request between concurrent callers', async () => {
    mocks.edition = 'community';
    mocks.get.mockResolvedValue({ data: { clusterScans: true } });
    const [a, b] = await Promise.all([fetchInstanceCapabilities(), fetchInstanceCapabilities()]);
    expect(a).toEqual({ clusterScans: true });
    expect(b).toEqual({ clusterScans: true });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no body', undefined],
    ['a string', 'true'],
    ['clusterScans as a string', { clusterScans: 'true' }],
    ['clusterScans as a number', { clusterScans: 1 }],
    ['an empty object', {}],
  ])('reads %s as not enabled', async (_label, data) => {
    mocks.edition = 'community';
    mocks.get.mockResolvedValue({ data });
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: false });
  });

  it('keeps only clusterScans from the answer', async () => {
    mocks.edition = 'community';
    mocks.get.mockResolvedValue({ data: { clusterScans: true, extra: 'x' } });
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: true });
  });

  it('a failure is asked again at most once in the same page load', async () => {
    mocks.edition = 'community';
    mocks.get.mockRejectedValue(new Error('Network Error'));
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: false });
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: false });
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: false });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('a synchronous throw of the client is a failure, not an exception', async () => {
    mocks.edition = 'community';
    mocks.get.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: false });
  });

  it('asks again after a reset', async () => {
    mocks.edition = 'community';
    mocks.get.mockResolvedValueOnce({ data: { clusterScans: false } });
    mocks.get.mockResolvedValueOnce({ data: { clusterScans: true } });
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: false });
    resetInstanceCapabilities();
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: true });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('outside the Community Edition sends no request', async () => {
    mocks.edition = 'cloud';
    await expect(fetchInstanceCapabilities()).resolves.toEqual({ clusterScans: false });
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
