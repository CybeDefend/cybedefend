import { Controller } from '@nestjs/common';
import {
  DataPurgeServiceController,
  DataPurgeServiceControllerMethods,
} from '@core/grpc/policy-management/data_purge';
import {
  PurgeDataResponse,
  PurgeOrganizationDataRequest,
  PurgeProjectDataRequest,
  PurgeTeamDataRequest,
} from '@core/grpc/data-purge/data_purge';
import { DataPurgeService } from './data-purge.service';
import { PURGE_CALL_BUDGET_MS } from './purge-tables';

/** Internal gRPC only (no gateway route): called by global-management's deletion job. */
@Controller()
@DataPurgeServiceControllerMethods()
export class DataPurgeController implements DataPurgeServiceController {
  constructor(private readonly purge: DataPurgeService) {}

  purgeProjectData(
    request: PurgeProjectDataRequest,
  ): Promise<PurgeDataResponse> {
    return this.purge.purgeProject(
      request.projectId,
      request.organizationId,
      Date.now() + PURGE_CALL_BUDGET_MS,
    );
  }

  purgeTeamData(request: PurgeTeamDataRequest): Promise<PurgeDataResponse> {
    return this.purge.purgeTeam(
      request.teamId,
      request.organizationId,
      Date.now() + PURGE_CALL_BUDGET_MS,
    );
  }

  purgeOrganizationData(
    request: PurgeOrganizationDataRequest,
  ): Promise<PurgeDataResponse> {
    return this.purge.purgeOrganization(
      request.organizationId,
      request.teamIds ?? [],
      Date.now() + PURGE_CALL_BUDGET_MS,
    );
  }
}
