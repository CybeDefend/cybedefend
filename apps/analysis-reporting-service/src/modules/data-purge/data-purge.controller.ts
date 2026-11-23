import { Controller, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import {
  DataPurgeServiceController,
  DataPurgeServiceControllerMethods,
} from '@grpc/analysis-reporting/data_purge';
import type {
  PurgeDataResponse,
  PurgeOrganizationDataRequest,
  PurgeProjectDataRequest,
  PurgeTeamDataRequest,
} from '@grpc/data-purge/data_purge';
import { PURGE_CALL_BUDGET_MS } from './batched-delete';
import { DataPurgeService } from './data-purge.service';

/**
 * Internal gRPC purge of a deleted project, team or organization, called by
 * global-management's deletion job until it answers `complete: true`. No
 * gateway route. An error carries its gRPC code only.
 */
@Controller()
@DataPurgeServiceControllerMethods()
export class DataPurgeController implements DataPurgeServiceController {
  private readonly logger = new Logger(DataPurgeController.name);

  constructor(private readonly purge: DataPurgeService) {}

  @Span()
  async purgeProjectData(
    request: PurgeProjectDataRequest,
  ): Promise<PurgeDataResponse> {
    return this.guard('project', () =>
      this.purge.purgeProject(
        request.projectId,
        request.organizationId,
        Date.now() + PURGE_CALL_BUDGET_MS,
      ),
    );
  }

  @Span()
  async purgeTeamData(
    request: PurgeTeamDataRequest,
  ): Promise<PurgeDataResponse> {
    return this.guard('team', () =>
      this.purge.purgeTeam(
        request.teamId,
        request.organizationId,
        Date.now() + PURGE_CALL_BUDGET_MS,
      ),
    );
  }

  @Span()
  async purgeOrganizationData(
    request: PurgeOrganizationDataRequest,
  ): Promise<PurgeDataResponse> {
    return this.guard('organization', () =>
      this.purge.purgeOrganization(
        request.organizationId,
        request.teamIds ?? [],
        Date.now() + PURGE_CALL_BUDGET_MS,
      ),
    );
  }

  private async guard(
    scope: string,
    run: () => Promise<PurgeDataResponse>,
  ): Promise<PurgeDataResponse> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof RpcException) throw err;
      // The error class and driver code only: a message can quote a row.
      this.logger.error(
        `Data purge of a ${scope} failed: ${(err as Error)?.name ?? 'Error'} ${
          (err as { code?: string })?.code ?? ''
        }`,
      );
      throw new RpcException({ code: status.INTERNAL, message: 'INTERNAL' });
    }
  }
}
