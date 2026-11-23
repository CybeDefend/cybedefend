import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';
import { ProjectSecurityContext } from '@grpc/global-management/project';

interface CacheEntry {
  context: ProjectSecurityContext | null;
  expiresAt: number;
}

/**
 * Caches the per-project security context fetched from global-management.
 * Used by:
 *  - CVSS environmental recalculation (existing)
 *  - stale-agent-analysis flag
 *
 * Single source of truth so the same projectId across multiple services in
 * the same process hits one round-trip per TTL window.
 */
@Injectable()
export class SecurityContextCacheService implements OnModuleInit {
  private projectServiceClient!: ProjectServiceClient;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 300_000; // 5 minutes

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.projectServiceClient =
      this.globalManagementClient.getService<ProjectServiceClient>(
        PROJECT_SERVICE_NAME,
      );
  }

  async get(projectId: string): Promise<ProjectSecurityContext | null> {
    const cached = this.cache.get(projectId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.context;
    }
    try {
      const response = await firstValueFrom(
        this.projectServiceClient.getProjectSecurityContext({ projectId }),
      );
      const ctx = response.securityContext ?? null;
      this.cache.set(projectId, {
        context: ctx,
        expiresAt: Date.now() + this.ttlMs,
      });
      return ctx;
    } catch {
      return null;
    }
  }

  /**
   * Convenience: returns the parsed updatedAt timestamp, or null if the
   * project has no security context (or the gRPC call failed).
   */
  async getUpdatedAt(projectId: string): Promise<Date | null> {
    const ctx = await this.get(projectId);
    if (!ctx?.updatedAt) return null;
    const parsed = new Date(ctx.updatedAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  invalidate(projectId: string): void {
    this.cache.delete(projectId);
  }
}
