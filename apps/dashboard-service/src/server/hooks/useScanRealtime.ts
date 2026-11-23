import { useRealtimeStream } from './useRealtimeStream';
import { useThrottledRealtimeRefresh } from './useThrottledRealtimeRefresh';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';

export type ScanRealtimeEventType = 'SCAN_STATUS_CHANGED' | 'AGENT_STEP_CHANGED' | 'SCAN_PIPELINE_CHANGED';

/**
 * Payload carried by a SCAN_PIPELINE_CHANGED SSE event. It only says that the scan moved; the pipeline itself is
 * read back through the throttled refetch of the scan.
 */
export interface ScanPipelineChangedPayload {
  scanId: string;
  reason: 'container_status' | 'slot_released' | 'agent_stage' | 'ai_progress';
}

/** The payload key under which each scan event names its scan. */
type ScanEventPayloadKey = 'scanPipelineChanged' | 'agentStepChanged' | 'scanStatusChanged';

/**
 * The scan an event is about, from its payload or its scope. Every scan event
 * of the issues stream names it in both; an event that names none is
 * undefined.
 */
function eventScanId(env: unknown, payloadKey: ScanEventPayloadKey): string | undefined {
  const e = env as
    | { payload?: Partial<Record<ScanEventPayloadKey, { scanId?: unknown }>>; scope?: { scanId?: unknown } }
    | undefined;
  const id = e?.payload?.[payloadKey]?.scanId ?? e?.scope?.scanId;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * Payload carried by a SCAN_STATUS_CHANGED SSE event.
 * The error fields are present only when the scan transitions to
 * `failed` or `completed_degraded`.
 */
export interface ScanStatusChangedPayload {
  type: 'SCAN_STATUS_CHANGED';
  scanId: string;
  previousState: string;
  currentState: string;
  errorCode?: number;
  errorCategory?: string;
  errorMessage?: string;
}

/**
 * Issues stream subscription for the Results pages.
 *
 * Wires the per-project SSE channel to the page's existing fetchScanData
 * callback. Scan-state and per-vuln agent-step transitions trigger an
 * immediate refresh — no need to wait on the polling fallback — but
 * adjacent events within a 5 s window are coalesced into a single trailing
 * call (see useThrottledRealtimeRefresh) so a burst never produces a
 * burst of REST requests.
 *
 * @param onScanStatusChanged - Optional callback invoked immediately (before
 *   the throttled REST re-fetch) with the full SCAN_STATUS_CHANGED payload.
 *   Use it to apply the failure reason fields (`errorCode`, `errorCategory`,
 *   `errorMessage`) optimistically so the UI can display them without waiting
 *   for the fallback REST call.
 */
export function useScanRealtime(
  projectId: string | undefined,
  scanId: string | undefined,
  onRefresh: () => void,
  onScanStatusChanged?: (payload: ScanStatusChangedPayload) => void,
): void {
  const url =
    features.realtime.issues &&
    projectId &&
    projectId.trim() !== '' &&
    scanId &&
    scanId.trim() !== ''
      ? `${getRegionConfig().apiUrl}/v1/realtime/projects/${projectId}/issues/stream`
      : null;

  const dispatch = useThrottledRealtimeRefresh(
    onRefresh,
    `${projectId ?? ''}|${scanId ?? ''}`,
  );

  const isAboutAnotherScan = (env: unknown, payloadKey: ScanEventPayloadKey): boolean => {
    const eventScan = eventScanId(env, payloadKey);
    return eventScan !== undefined && eventScan !== scanId;
  };

  useRealtimeStream(
    url,
    {
      // The issues stream carries every scan of the project, and a full scan
      // and a diff scan of it overlap: react to the watched scan
      // only. Applying another scan's status would show its state and error
      // in this scan's loader. An event naming no scan still refetches.
      SCAN_STATUS_CHANGED: (env?: any) => {
        if (isAboutAnotherScan(env, 'scanStatusChanged')) return;
        const p = env?.payload?.scanStatusChanged ?? env; // tolerate both wire + flat (tests)
        if (onScanStatusChanged && p) {
          onScanStatusChanged({ type: 'SCAN_STATUS_CHANGED', ...p } as ScanStatusChangedPayload);
        }
        dispatch();
      },
      AGENT_STEP_CHANGED: (env?: unknown) => {
        if (isAboutAnotherScan(env, 'agentStepChanged')) return;
        dispatch();
      },
      SCAN_PIPELINE_CHANGED: (env?: unknown) => {
        if (isAboutAnotherScan(env, 'scanPipelineChanged')) return;
        dispatch();
      },
      // Stream reconnected — a SCAN_STATUS_CHANGED may have been lost while it
      // was down; re-read the scan so the loader does not wait for the poll.
      'snapshot-required': dispatch,
    },
    [projectId, scanId],
  );
}

export default useScanRealtime;
