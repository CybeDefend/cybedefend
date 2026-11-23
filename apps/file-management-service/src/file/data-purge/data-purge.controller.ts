import { Controller } from '@nestjs/common';
import {
  DataPurgeServiceController,
  DataPurgeServiceControllerMethods,
} from '@grpc/file-management/data_purge';
import {
  PurgeDataResponse,
  PurgeOrganizationDataRequest,
  PurgeProjectDataRequest,
  PurgeTeamDataRequest,
} from '@grpc/data-purge/data_purge';
import { DataPurgeService, PURGE_CALL_BUDGET_MS } from './data-purge.service';

/** Internal gRPC only (cybedefend.file_management.DataPurgeService), called by global-management's purge runner. */
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
