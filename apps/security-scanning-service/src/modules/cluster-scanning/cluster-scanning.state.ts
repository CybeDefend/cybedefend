import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import {
  CLUSTER_SCANNING_CONFIG,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import {
  COMMUNITY_KUBE_CLIENT,
  type CommunityKubeClient,
  type KubeFailure,
} from './kube-client';
import { ALLOW_INSECURE_TLS_VARIABLE } from './kubeconfig-tls';

/** With a configuration, the access review runs again this often, enabled or not. */
export const CLUSTER_RECHECK_MS = 5 * 60_000;

/** Hosts a pod on another machine cannot reach the instance through. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
]);

/** The host of a URL, brackets of an IPv6 literal removed; null when unparsable. */
function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether the Community cluster engine may launch scanner pods.
 *
 * - No configuration: import-only. No client, no review, no timer, and not
 *   one log line about a cluster.
 * - With a configuration, the access review (SelfSubjectAccessReview of the
 *   six verbs) runs once at bootstrap, then again every CLUSTER_RECHECK_MS
 *   whatever the state: a cluster fixed or reachable later enables the
 *   engine without a restart, and while enabled only an
 *   `access_denied` or `insecure_tls` answer turns it off; `cluster_unreachable` or
 *   `kubeconfig_unreadable` then keeps it on. A failure never stops the
 *   service.
 * - A line is logged only when the outcome changes: one INFO
 *   CLUSTER_SCANNING_ENABLED namespace=<ns> instance=<id> (the
 *   cybedefend.io/instance label, a hash of the public URL), or one WARN
 *   CLUSTER_SCANNING_DISABLED reason=<reason>.
 * - At bootstrap, one WARN CLUSTER_SCANNING_UNREACHABLE_ADDRESS
 *   variable=<name> per variable whose host is a loopback address (pods
 *   upload to FRONTEND_URL and fetch the archive from S3_PUBLIC_ENDPOINT).
 *   The line names the variable, never its value, and the engine stays
 *   enabled: a cluster on the same machine may still route to it.
 */
@Injectable()
export class ClusterScanningState
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ClusterScanningState.name);
  private isEnabled = false;
  /** The outcome last logged: 'enabled' or the failure reason. */
  private lastOutcome: 'enabled' | KubeFailure | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private destroyed = false;

  constructor(
    @Inject(CLUSTER_SCANNING_CONFIG)
    private readonly config: ClusterScanningConfig | null,
    @Optional()
    @Inject(COMMUNITY_KUBE_CLIENT)
    private readonly client: CommunityKubeClient | null,
  ) {}

  get enabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Starts the first review without waiting for it: an unreachable cluster
   * would otherwise hold the boot for the client's 10 s deadline. Until it
   * answers, the engine is disabled.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.config || !this.client) return;
    if (this.config.allowInsecureTls) {
      this.logger.warn(
        `CLUSTER_SCANNING_INSECURE_TLS_ALLOWED variable=${ALLOW_INSECURE_TLS_VARIABLE}`,
      );
    }
    this.warnUnreachableAddresses(this.config);
    void this.check();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.stopRecheck();
  }

  /** Runs the access review; logs only when the state changes. */
  check(): Promise<void> {
    if (!this.config || !this.client) return Promise.resolve();
    // one review at a time: a slow review is not stacked by the timer
    if (!this.inFlight) {
      this.inFlight = this.review().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async review(): Promise<void> {
    let outcome: 'enabled' | KubeFailure;
    try {
      const answer = await this.client.reviewAccess();
      outcome = 'reason' in answer ? answer.reason : 'enabled';
    } catch {
      // The client turns every failure into a reason; anything else is a
      // cluster the engine cannot use either. Nothing of the error is logged.
      outcome = 'cluster_unreachable';
    }
    // Once enabled, only an access refusal or an unverified API server turns
    // the engine off. An unreachable cluster keeps it on: its scans then fail
    // 83 by themselves, and a network blip must not hide « Start scan ».
    if (
      this.isEnabled &&
      outcome !== 'access_denied' &&
      outcome !== 'insecure_tls'
    ) {
      outcome = 'enabled';
    }
    this.isEnabled = outcome === 'enabled';
    if (outcome !== this.lastOutcome) {
      this.lastOutcome = outcome;
      if (outcome === 'enabled') {
        this.logger.log(
          `CLUSTER_SCANNING_ENABLED namespace=${this.config.namespace} instance=${this.config.instanceId}`,
        );
      } else {
        this.logger.warn(`CLUSTER_SCANNING_DISABLED reason=${outcome}`);
      }
    }
    this.startRecheck();
  }

  private startRecheck(): void {
    if (this.timer || this.destroyed) return;
    this.timer = setInterval(() => {
      void this.check();
    }, CLUSTER_RECHECK_MS);
    this.timer.unref?.();
  }

  private stopRecheck(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private warnUnreachableAddresses(config: ClusterScanningConfig): void {
    const variables: Array<[string, string | null]> = [
      ['FRONTEND_URL', config.apiUrl],
      ['S3_PUBLIC_ENDPOINT', config.storagePublicUrl],
    ];
    for (const [variable, url] of variables) {
      const host = hostOf(url);
      if (host !== null && LOOPBACK_HOSTS.has(host)) {
        this.logger.warn(
          `CLUSTER_SCANNING_UNREACHABLE_ADDRESS variable=${variable}`,
        );
      }
    }
  }
}
