import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';

/**
 * Resolves a project's organizationId via gRPC, with an in-memory cache.
 * Used by RealtimeBatchPublisher to enrich realtime events that only carry
 * projectId so they can also be routed to the org-level overview channel.
 *
 * The cache lives for the worker process lifetime; org membership doesn't
 * change in practice. Failed lookups are NOT cached so a transient gRPC
 * outage doesn't poison the resolver.
 */
@Injectable()
export class ProjectOrgResolver implements OnModuleInit {
  private readonly logger = new Logger(ProjectOrgResolver.name);
  private projectClient!: ProjectServiceClient;
  private readonly cache = new Map<string, string>();

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE') private readonly gmClient: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.projectClient =
      this.gmClient.getService<ProjectServiceClient>(PROJECT_SERVICE_NAME);
  }

  async resolveOrgId(projectId: string): Promise<string | null> {
    const cached = this.cache.get(projectId);
    if (cached) return cached;
    try {
      const project: any = await firstValueFrom(
        this.projectClient.get({ projectId }) as any,
      );
      const orgId = project?.organizationId;
      if (orgId) {
        this.cache.set(projectId, orgId);
        return orgId;
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `resolveOrgId(${projectId}) failed: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
