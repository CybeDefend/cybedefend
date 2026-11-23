import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import {
  CLUSTER_SCAN_SERVICE_NAME,
  type ClusterScanServiceClient,
} from '@grpc/security-scanning/security_scanning';

/** How often the answer is read again. */
export const SCAN_CAPABILITY_REFRESH_MS = 60_000;
/** How long one call may take before it counts as failed. */
export const SCAN_CAPABILITY_DEADLINE_MS = 2_000;
/** How long the last answer is kept while every call fails. */
export const SCAN_CAPABILITY_STALE_MS = 5 * 60_000;

function grpcCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

/**
 * Community Edition: whether security-scanning runs scans on a connected
 * Kubernetes cluster (`ClusterScanService.GetScanCapabilities`), read at
 * bootstrap and every 60 s, each call bounded at 2 s. A push and a link start
 * a scan only when the answer is `true` (CommunityEntitlements).
 *
 * - UNIMPLEMENTED (a security-scanning without the engine, or the cloud) is
 *   an answer: no cluster.
 * - Any other failure keeps the last answer for 5 min after it was read,
 *   then `current()` is `null` (unknown). Before any answer it is `null`.
 *
 * Provided only in the Community Edition (ScanCapabilityModule, listed in
 * COMMUNITY_ONLY_MODULES): the cloud never calls GetScanCapabilities.
 */
@Injectable()
export class ScanCapabilityCache
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ScanCapabilityCache.name);
  private service: ClusterScanServiceClient | undefined;
  private timer: NodeJS.Timeout | undefined;
  private answer: boolean | null = null;
  private answeredAt: number | null = null;
  private failing = false;

  constructor(
    @Inject('SECURITY_SCANNING_SERVICE') private readonly client: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.service = this.client.getService<ClusterScanServiceClient>(
      CLUSTER_SCAN_SERVICE_NAME,
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.refresh();
      }, SCAN_CAPABILITY_REFRESH_MS);
      this.timer.unref?.();
    }
    await this.refresh();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** `true`: a cluster runs scans; `false`: none; `null`: unknown. */
  current(): boolean | null {
    if (this.answeredAt === null) {
      return null;
    }
    if (Date.now() - this.answeredAt >= SCAN_CAPABILITY_STALE_MS) {
      return null;
    }
    return this.answer;
  }

  /** Reads the answer once. Never throws. */
  async refresh(): Promise<void> {
    try {
      if (!this.service) {
        this.onModuleInit();
      }
      const response = await firstValueFrom(
        this.service
          .getScanCapabilities({})
          .pipe(timeout(SCAN_CAPABILITY_DEADLINE_MS)),
      );
      this.record(response?.clusterScans === true);
    } catch (error: unknown) {
      const code = grpcCode(error);
      if (code === status.UNIMPLEMENTED) {
        this.record(false);
        return;
      }
      if (!this.failing) {
        this.failing = true;
        this.logger.warn(
          `SCAN_CAPABILITY_UNREADABLE code=${code ?? (error instanceof TimeoutError ? 'deadline' : 'unknown')}`,
        );
      }
    }
  }

  private record(clusterScans: boolean): void {
    if (this.answer !== null && this.answer !== clusterScans) {
      this.logger.log(`SCAN_CAPABILITY_CHANGED cluster_scans=${clusterScans}`);
    }
    this.answer = clusterScans;
    this.answeredAt = Date.now();
    this.failing = false;
  }
}
