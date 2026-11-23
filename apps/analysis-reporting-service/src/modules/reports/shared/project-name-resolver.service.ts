import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';
import { firstValueFrom } from 'rxjs';

import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';
import { projectSettingsRequest } from '../../../core/utils/project-read.util';

/**
 * Resolves a project's readable name through global-management
 * `ProjectService.Get`. Shared by every report (OWASP, CWE, Scanner Type,
 * SBOM, EU AI Act) so the same gRPC lookup is not duplicated.
 *
 * The name is a project column, so the light read is enough (no
 * vulnerability statistics, integration status or security context).
 *
 * Fail-soft: when the lookup fails (service down, project not found),
 * `undefined` is returned rather than failing the report generation — the
 * header then falls back to the projectId (UUID) alone.
 */
@Injectable()
export class ProjectNameResolver implements OnModuleInit {
  private readonly logger = new Logger(ProjectNameResolver.name);
  private projectServiceClient: ProjectServiceClient;

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.projectServiceClient =
      this.globalManagementClient.getService<ProjectServiceClient>(
        PROJECT_SERVICE_NAME,
      );
  }

  @Span()
  async resolve(projectId: string): Promise<string | undefined> {
    try {
      // Lazy init: onModuleInit primes the client, but it is resolved again
      // here to be safe (e.g. a test context without lifecycle hooks).
      if (!this.projectServiceClient) {
        this.projectServiceClient =
          this.globalManagementClient.getService<ProjectServiceClient>(
            PROJECT_SERVICE_NAME,
          );
      }
      const response = await firstValueFrom(
        this.projectServiceClient.get(projectSettingsRequest(projectId)),
      );
      return response?.name || undefined;
    } catch (err) {
      this.logger.warn(
        `ProjectNameResolver: failed to resolve project name for ${projectId}: ${
          (err as Error)?.message ?? err
        }`,
      );
      return undefined;
    }
  }
}
