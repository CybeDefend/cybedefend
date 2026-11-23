import { Controller, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  DataPurgeServiceController,
  DataPurgeServiceControllerMethods,
} from '@grpc/security-scanning/data_purge';
import type {
  PurgeDataResponse,
  PurgeProjectDataRequest,
} from '@grpc/data-purge/data_purge';
import { DataPurgeService } from './data-purge.service';
import { PURGE_CALL_BUDGET_MS } from './batched-delete';

/**
 * Internal purge of a deleted project's scans, called by global-management's
 * purge runner until it answers `complete`. No gateway route.
 */
@Controller()
@DataPurgeServiceControllerMethods()
export class DataPurgeController implements DataPurgeServiceController {
  private readonly logger = new Logger(DataPurgeController.name);

  constructor(private readonly dataPurgeService: DataPurgeService) {}

  async purgeProjectData(
    request: PurgeProjectDataRequest,
  ): Promise<PurgeDataResponse> {
    try {
      return await this.dataPurgeService.purgeProject(
        request.projectId,
        request.organizationId,
        Date.now() + PURGE_CALL_BUDGET_MS,
      );
    } catch (error) {
      if (error instanceof RpcException) throw error;
      // The message carries the gRPC code only: a driver error can quote SQL
      // and its values.
      this.logger.error(
        `Data purge of a project failed: ${error instanceof Error ? error.constructor.name : typeof error}`,
      );
      throw new RpcException({ code: status.INTERNAL, message: 'INTERNAL' });
    }
  }
}
