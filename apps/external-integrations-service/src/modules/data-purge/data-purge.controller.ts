import { Controller } from '@nestjs/common';
import { Span } from 'nestjs-otel';
import {
  DataPurgeServiceController,
  DataPurgeServiceControllerMethods,
} from '@grpc/external-integrations/data_purge';
import {
  PurgeDataResponse,
  PurgeOrganizationDataRequest,
  PurgeProjectDataRequest,
} from '@grpc/data-purge/data_purge';
import { DataPurgeService } from './data-purge.service';
import { PURGE_CALL_BUDGET_MS } from './purge-tables';

/**
 * Internal gRPC only (`cybedefend.external_integrations.DataPurgeService`),
 * called by global-management's deletion runner. No gateway route.
 */
@Controller()
@DataPurgeServiceControllerMethods()
export class DataPurgeController implements DataPurgeServiceController {
  constructor(private readonly purge: DataPurgeService) {}

  @Span()
  async purgeProjectData(
    request: PurgeProjectDataRequest,
  ): Promise<PurgeDataResponse> {
    return this.purge.purgeProject(
      request.projectId,
      request.organizationId,
      Date.now() + PURGE_CALL_BUDGET_MS,
    );
  }

  @Span()
  async purgeOrganizationData(
    request: PurgeOrganizationDataRequest,
  ): Promise<PurgeDataResponse> {
    return this.purge.purgeOrganization(
      request.organizationId,
      request.teamIds ?? [],
      Date.now() + PURGE_CALL_BUDGET_MS,
    );
  }
}
