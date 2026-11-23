import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const realtimeMock = vi.fn();
vi.mock('./useRealtimeStream', () => ({
  useRealtimeStream: (
    url: string | null,
    handlers: Record<string, (...args: unknown[]) => void>,
    deps: unknown[],
  ) => {
    realtimeMock(url, handlers, deps);
  },
}));

vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api' }),
}));

vi.mock('@/utils/featureFlags', () => ({
  features: { realtime: { issues: true } },
}));

import { useScanRealtime, ScanStatusChangedPayload } from './useScanRealtime';

beforeEach(() => {
  realtimeMock.mockClear();
});

describe('useScanRealtime', () => {
  it('opens the issues stream for the given project when scan id is set', () => {
    renderHook(() => useScanRealtime('p1', 's1', vi.fn()));
    expect(realtimeMock).toHaveBeenCalled();
    const [url] = realtimeMock.mock.calls.at(-1)!;
    expect(url).toBe('https://api/v1/realtime/projects/p1/issues/stream');
  });

  it('does NOT open a stream while no scan is active', () => {
    renderHook(() => useScanRealtime('p1', '', vi.fn()));
    const [url] = realtimeMock.mock.calls.at(-1)!;
    expect(url).toBeNull();
  });

  it('does NOT open a stream when project id is empty', () => {
    renderHook(() => useScanRealtime('', 's1', vi.fn()));
    const [url] = realtimeMock.mock.calls.at(-1)!;
    expect(url).toBeNull();
  });

  it('calls the consumer refresh when SCAN_STATUS_CHANGED fires', () => {
    const onRefresh = vi.fn();
    renderHook(() => useScanRealtime('p1', 's1', onRefresh));
    const [, handlers] = realtimeMock.mock.calls.at(-1)!;
    handlers.SCAN_STATUS_CHANGED!({ type: 'SCAN_STATUS_CHANGED' });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls the consumer refresh on snapshot-required (stream reconnected)', () => {
    const onRefresh = vi.fn();
    renderHook(() => useScanRealtime('p1', 's1', onRefresh));
    const [, handlers] = realtimeMock.mock.calls.at(-1)!;
    handlers['snapshot-required']!({ type: 'snapshot-required' });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onScanStatusChanged with unwrapped fields when SCAN_STATUS_CHANGED fires with the real wire envelope', () => {
    const onRefresh = vi.fn();
    const onScanStatusChanged = vi.fn();
    renderHook(() => useScanRealtime('p1', 's1', onRefresh, onScanStatusChanged));
    const [, handlers] = realtimeMock.mock.calls.at(-1)!;
    // Simulate the real wire shape: fields are nested under payload.scanStatusChanged
    handlers.SCAN_STATUS_CHANGED!({
      type: 'SCAN_STATUS_CHANGED',
      payload: {
        scanStatusChanged: {
          scanId: 's1',
          previousState: 'running',
          currentState: 'failed',
          errorCode: 41,
          errorCategory: 'scan',
          errorMessage: 'Image not found',
        },
      },
    });
    expect(onScanStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SCAN_STATUS_CHANGED',
        scanId: 's1',
        previousState: 'running',
        currentState: 'failed',
        errorCode: 41,
        errorCategory: 'scan',
        errorMessage: 'Image not found',
      }),
    );
  });

  it('passes errorCode and errorCategory from the real nested SSE envelope to onScanStatusChanged', () => {
    const onScanStatusChanged = vi.fn();
    renderHook(() => useScanRealtime('p1', 's1', vi.fn(), onScanStatusChanged));
    const [, handlers] = realtimeMock.mock.calls.at(-1)!;
    // Real wire shape — fields nested under payload.scanStatusChanged
    handlers.SCAN_STATUS_CHANGED!({
      type: 'SCAN_STATUS_CHANGED',
      payload: {
        scanStatusChanged: {
          scanId: 's1',
          previousState: 'running',
          currentState: 'failed',
          errorCode: 41,
          errorCategory: 'scan',
        },
      },
    });
    const received = onScanStatusChanged.mock.calls[0][0] as ScanStatusChangedPayload;
    expect(received.currentState).toBe('failed');
    expect(received.errorCode).toBe(41);
    expect(received.errorCategory).toBe('scan');
  });

  it('still calls onRefresh even when onScanStatusChanged is provided', () => {
    const onRefresh = vi.fn();
    const onScanStatusChanged = vi.fn();
    renderHook(() => useScanRealtime('p1', 's1', onRefresh, onScanStatusChanged));
    const [, handlers] = realtimeMock.mock.calls.at(-1)!;
    handlers.SCAN_STATUS_CHANGED!({
      type: 'SCAN_STATUS_CHANGED',
      payload: {
        scanStatusChanged: {
          scanId: 's1',
          previousState: 'running',
          currentState: 'failed',
          errorCode: 20,
          errorCategory: 'cloud_provider',
        },
      },
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onScanStatusChanged).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onScanStatusChanged for AGENT_STEP_CHANGED events', () => {
    const onScanStatusChanged = vi.fn();
    renderHook(() => useScanRealtime('p1', 's1', vi.fn(), onScanStatusChanged));
    const [, handlers] = realtimeMock.mock.calls.at(-1)!;
    handlers.AGENT_STEP_CHANGED!({ type: 'AGENT_STEP_CHANGED' });
    expect(onScanStatusChanged).not.toHaveBeenCalled();
  });

  it('calls the consumer refresh when AGENT_STEP_CHANGED fires', () => {
    const onRefresh = vi.fn();
    renderHook(() => useScanRealtime('p1', 's1', onRefresh));
    const [, handlers] = realtimeMock.mock.calls.at(-1)!;
    handlers.AGENT_STEP_CHANGED!({ type: 'AGENT_STEP_CHANGED' });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  describe('SCAN_PIPELINE_CHANGED', () => {
    const pipelineEvent = (scanId?: string, scope?: Record<string, string>) => ({
      type: 'SCAN_PIPELINE_CHANGED',
      scope,
      payload: { scanPipelineChanged: { scanId, reason: 'agent_stage' } },
    });

    it('refetches the watched scan, like AGENT_STEP_CHANGED', () => {
      const onRefresh = vi.fn();
      renderHook(() => useScanRealtime('p1', 's1', onRefresh));
      const [, handlers] = realtimeMock.mock.calls.at(-1)!;
      handlers.SCAN_PIPELINE_CHANGED!(pipelineEvent('s1'));
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('ignores the pipeline of another scan of the project', () => {
      const onRefresh = vi.fn();
      renderHook(() => useScanRealtime('p1', 's1', onRefresh));
      const [, handlers] = realtimeMock.mock.calls.at(-1)!;
      handlers.SCAN_PIPELINE_CHANGED!(pipelineEvent('s2'));
      handlers.SCAN_PIPELINE_CHANGED!(pipelineEvent(undefined, { projectId: 'p1', scanId: 's2' }));
      expect(onRefresh).not.toHaveBeenCalled();
    });

    it('refetches when the event names no scan rather than risk a stale page', () => {
      const onRefresh = vi.fn();
      renderHook(() => useScanRealtime('p1', 's1', onRefresh));
      const [, handlers] = realtimeMock.mock.calls.at(-1)!;
      handlers.SCAN_PIPELINE_CHANGED!({ type: 'SCAN_PIPELINE_CHANGED' });
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('shares the throttle of the other scan events', () => {
      vi.useFakeTimers();
      try {
        const onRefresh = vi.fn();
        renderHook(() => useScanRealtime('p1', 's1', onRefresh));
        const [, handlers] = realtimeMock.mock.calls.at(-1)!;
        handlers.AGENT_STEP_CHANGED!({ type: 'AGENT_STEP_CHANGED' });
        handlers.SCAN_PIPELINE_CHANGED!(pipelineEvent('s1'));
        handlers.SCAN_PIPELINE_CHANGED!(pipelineEvent('s1'));
        expect(onRefresh).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(5000);
        expect(onRefresh).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // The issues stream carries every scan of the project. A
  // full scan and an agents-space diff scan of the same project overlap, so the
  // page following one of them used to refetch on the other's events, and to
  // write the other's state and error message into its own loader.
  describe('events of another scan of the project', () => {
    const agentStep = (scanId?: string, scope?: Record<string, string>) => ({
      type: 'AGENT_STEP_CHANGED',
      scope,
      payload: {
        agentStepChanged: { scanId, podName: 'pod', previousStep: 'a', currentStep: 'b' },
      },
    });
    const statusChanged = (scanId?: string, scope?: Record<string, string>) => ({
      type: 'SCAN_STATUS_CHANGED',
      scope,
      payload: {
        scanStatusChanged: {
          scanId,
          previousState: 'running',
          currentState: 'failed',
          errorCode: 41,
          errorMessage: 'Image not found',
        },
      },
    });

    it('ignores the agent step of another scan, named in the payload or only in the scope', () => {
      const onRefresh = vi.fn();
      renderHook(() => useScanRealtime('p1', 's1', onRefresh));
      const [, handlers] = realtimeMock.mock.calls.at(-1)!;
      handlers.AGENT_STEP_CHANGED!(agentStep('s2'));
      handlers.AGENT_STEP_CHANGED!(agentStep(undefined, { projectId: 'p1', scanId: 's2' }));
      expect(onRefresh).not.toHaveBeenCalled();
    });

    it('neither applies nor refetches the status of another scan', () => {
      const onRefresh = vi.fn();
      const onScanStatusChanged = vi.fn();
      renderHook(() => useScanRealtime('p1', 's1', onRefresh, onScanStatusChanged));
      const [, handlers] = realtimeMock.mock.calls.at(-1)!;
      handlers.SCAN_STATUS_CHANGED!(statusChanged('s2'));
      handlers.SCAN_STATUS_CHANGED!(statusChanged(undefined, { projectId: 'p1', scanId: 's2' }));
      expect(onScanStatusChanged).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
    });

    it('still refetches on the watched scan’s own agent step', () => {
      const onRefresh = vi.fn();
      renderHook(() => useScanRealtime('p1', 's1', onRefresh));
      const [, handlers] = realtimeMock.mock.calls.at(-1)!;
      handlers.AGENT_STEP_CHANGED!(agentStep(undefined, { projectId: 'p1', scanId: 's1' }));
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('still applies and refetches the watched scan’s own status', () => {
      const onRefresh = vi.fn();
      const onScanStatusChanged = vi.fn();
      renderHook(() => useScanRealtime('p1', 's1', onRefresh, onScanStatusChanged));
      const [, handlers] = realtimeMock.mock.calls.at(-1)!;
      handlers.SCAN_STATUS_CHANGED!(statusChanged('s1'));
      expect(onScanStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({ scanId: 's1', currentState: 'failed', errorCode: 41 }),
      );
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('refetches on an event that names no scan rather than risk a stale page', () => {
      vi.useFakeTimers();
      try {
        const onRefresh = vi.fn();
        renderHook(() => useScanRealtime('p1', 's1', onRefresh));
        const [, handlers] = realtimeMock.mock.calls.at(-1)!;
        handlers.SCAN_STATUS_CHANGED!(statusChanged(undefined));
        vi.advanceTimersByTime(5000);
        handlers.AGENT_STEP_CHANGED!(agentStep(undefined));
        expect(onRefresh).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('uses a stable deps array so re-renders do not tear down the stream', () => {
    const onRefresh = vi.fn();
    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useScanRealtime('p1', 's1', cb),
      { initialProps: { cb: onRefresh } },
    );
    rerender({ cb: vi.fn() });
    const depsCall1 = realtimeMock.mock.calls[0][2];
    const depsCall2 = realtimeMock.mock.calls.at(-1)![2];
    expect(depsCall2).toEqual(depsCall1);
  });

  describe('throttle (max 1 refresh per 5s window)', () => {
    // Detailed throttle behaviour is owned by useThrottledRealtimeRefresh
    // (see its spec). Here we assert the integration: a burst of scan
    // events on the issues page is collapsed to 1 leading + 1 trailing
    // refresh per consumer.

    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('coalesces a burst of mixed scan events into a leading + trailing refresh', () => {
      const onRefresh = vi.fn();
      renderHook(() => useScanRealtime('p1', 's1', onRefresh));
      const [, handlers] = realtimeMock.mock.calls.at(-1)!;

      handlers.AGENT_STEP_CHANGED!({ type: 'AGENT_STEP_CHANGED' });
      expect(onRefresh).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(500);
      handlers.AGENT_STEP_CHANGED!({ type: 'AGENT_STEP_CHANGED' });
      handlers.SCAN_STATUS_CHANGED!({ type: 'SCAN_STATUS_CHANGED' });
      handlers.AGENT_STEP_CHANGED!({ type: 'AGENT_STEP_CHANGED' });
      expect(onRefresh).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      expect(onRefresh).toHaveBeenCalledTimes(2);
    });

    it('does NOT fire a trailing refresh after unmount', () => {
      const onRefresh = vi.fn();
      const { unmount } = renderHook(() =>
        useScanRealtime('p1', 's1', onRefresh),
      );
      const [, handlers] = realtimeMock.mock.calls.at(-1)!;

      handlers.AGENT_STEP_CHANGED!({ type: 'AGENT_STEP_CHANGED' });
      handlers.AGENT_STEP_CHANGED!({ type: 'AGENT_STEP_CHANGED' });
      expect(onRefresh).toHaveBeenCalledTimes(1);

      unmount();
      vi.advanceTimersByTime(10_000);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });
});
