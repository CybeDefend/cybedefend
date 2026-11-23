import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { Span } from 'nestjs-otel';
import { lastValueFrom, timeout, TimeoutError } from 'rxjs';
import {
  PROJECT_INTEGRATION_STATUS_SERVICE_NAME,
  ProjectIntegrationStatusServiceClient,
} from '@grpc/external-integrations/external_integrations';
import { propagateGrpcError } from '@grpc/wrapper-grpc.module';

/**
 * How long the branch may take. It can need one call to GitHub or GitLab
 * (a branch a webhook has not brought yet), which retries on its own.
 */
export const BRANCH_RESOLUTION_TIMEOUT_MS = 20_000;

/**
 * The branch a container scan is stored on, decided by
 * external-integrations, which holds the project's repository and its
 * branches (ResolveScanBranch). Its refusal (INVALID_ARGUMENT: a branch the
 * linked repository does not have) keeps its code and message up to the
 * gateway, which answers 400; no answer in time is UNAVAILABLE.
 */
@Injectable()
export class ContainerScanBranchResolver implements OnModuleInit {
  private projectIntegrationStatus!: ProjectIntegrationStatusServiceClient;

  constructor(
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly externalIntegrationsClient: ClientGrpc,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.projectIntegrationStatus =
      this.externalIntegrationsClient.getService<ProjectIntegrationStatusServiceClient>(
        PROJECT_INTEGRATION_STATUS_SERVICE_NAME,
      );
  }

  @Span()
  async resolve(
    projectId: string,
    branch: string,
    referenceBranch: string,
  ): Promise<string> {
    try {
      const answer = await lastValueFrom(
        this.projectIntegrationStatus
          .resolveScanBranch({ projectId, branch, referenceBranch })
          .pipe(timeout(BRANCH_RESOLUTION_TIMEOUT_MS)),
      );
      return answer.branch;
    } catch (error) {
      // Deploy order: an external-integrations older than ResolveScanBranch
      // has no repository check to offer. The branch is stored as the
      // unlinked rule would store it, unchecked, rather than failing every
      // container scan until it is deployed.
      if ((error as { code?: unknown })?.code === status.UNIMPLEMENTED) {
        const stored = branch.trim() || referenceBranch.trim() || 'main';
        this.logger.warn(
          `BRANCH_UNCHECKED project=${projectId} branch=${stored}: external-integrations has no ResolveScanBranch yet`,
        );
        return stored;
      }
      if (error instanceof TimeoutError) {
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: 'Could not check the scan branch in time; retry later.',
        });
      }
      throw propagateGrpcError(error);
    }
  }
}
