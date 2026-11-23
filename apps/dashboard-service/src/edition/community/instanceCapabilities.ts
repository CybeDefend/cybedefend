import { useEffect, useState } from 'react';
import gatewayAPI from '@/server/api/gatewayAPI';
import { EDITION } from '@/edition/edition';

/**
 * What a Community Edition instance can do beyond importing results, read once
 * per page load from `GET /instance/capabilities`. `clusterScans` is true when
 * the instance runs scans on a connected Kubernetes cluster: it drives
 * « Start scan », the Scanning tab and « scan on every commit ».
 */
export interface InstanceCapabilities {
  clusterScans: boolean;
}

/** What the dashboard assumes when the answer cannot be read: an import-only instance. */
const NOT_ENABLED: InstanceCapabilities = { clusterScans: false };

let shared: Promise<InstanceCapabilities> | null = null;
/** The last SUCCESSFUL answer; a failure is never stored here. */
let known: InstanceCapabilities | null = null;
/** Failed requests of this page load; after {@link MAX_FAILED_REQUESTS}, no new one is sent. */
let failures = 0;
/**
 * A transient failure (a network blip, a 401 sent before sign-in) is not kept
 * for the page load: the next read asks once more. Past that, the instance
 * stays « not enabled » until the next page load, so a gateway that is really
 * down costs at most one extra request.
 */
const MAX_FAILED_REQUESTS = 2;
/** Mounted hooks, told when a successful answer lands after they mounted. */
const listeners = new Set<(capabilities: InstanceCapabilities) => void>();

/** Only a boolean `true` enables scans; any other shape is « not enabled ». */
function readAnswer(data: unknown): InstanceCapabilities {
  if (data !== null && typeof data === 'object' && (data as { clusterScans?: unknown }).clusterScans === true) {
    return { clusterScans: true };
  }
  return NOT_ENABLED;
}

/**
 * GET /instance/capabilities through the API client. A successful answer is
 * kept for the page load and shared by every caller; a failure answers
 * { clusterScans: false } and is not kept, so a later read asks once more (at
 * most one retry per page load). Never called outside the Community Edition:
 * there it sends nothing and answers « not enabled » (the cloud's route does
 * not exist; {@link useScansRun} never asks it).
 */
export function fetchInstanceCapabilities(): Promise<InstanceCapabilities> {
  if (EDITION !== 'community') return Promise.resolve(NOT_ENABLED);
  if (known) return Promise.resolve(known);
  if (!shared) {
    let sent: Promise<{ data?: unknown } | undefined>;
    try {
      sent = gatewayAPI.get('/instance/capabilities');
    } catch (error) {
      // A synchronous throw of the client is a failure like any other.
      sent = Promise.reject(error);
    }
    const request: Promise<InstanceCapabilities> = sent.then(
        (response) => {
          const capabilities = readAnswer(response?.data);
          // An answer that lands after a reset belongs to the page load before it.
          if (shared === request) {
            known = capabilities;
            listeners.forEach((listener) => listener(capabilities));
          }
          return capabilities;
        },
        () => {
          if (shared === request) {
            failures += 1;
            // Forget the failed request, so that a later read may ask again.
            if (failures < MAX_FAILED_REQUESTS) shared = null;
          }
          return NOT_ENABLED;
        },
      );
    shared = request;
  }
  return shared;
}

/**
 * true outside the Community Edition; in it, true only once a successful
 * answer says clusterScans (false while loading, and after a failure until a
 * later successful answer). Mount it only inside the signed-in shell: the
 * route needs a session.
 */
export function useScansRun(): boolean {
  const community = EDITION === 'community';
  const [scansRun, setScansRun] = useState<boolean>(() => !community || known?.clusterScans === true);

  useEffect(() => {
    if (!community) return undefined;
    let active = true;
    const listener = (capabilities: InstanceCapabilities) => {
      if (active) setScansRun(capabilities.clusterScans);
    };
    listeners.add(listener);
    // A read that rejects leaves the hook « not enabled », never an unhandled rejection.
    void fetchInstanceCapabilities().then(listener).catch(() => undefined);
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, [community]);

  return community ? scansRun : true;
}

/** Forgets the answer and the failures, so that the next read asks again (tests). */
export function resetInstanceCapabilities(): void {
  shared = null;
  known = null;
  failures = 0;
}
