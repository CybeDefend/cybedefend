import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { PurgeDataResponse } from '@grpc/data-purge/data_purge';
import { CORE_PURGE_STEPS } from '../../modules/data-purge/data-purge.ledger';
import type {
  PurgeStepsByKind,
  PurgeStepsPort,
} from '../ports/purge-steps.port';

/**
 * The community purge steps: the Community Edition has no AI agent relay,
 * no billing service and no marketing leads (their table is closed), so
 * every kind of job runs the core services plus Permify only,
 * and an edition step never reaches the port.
 */
@Injectable()
export class CommunityPurgeSteps implements PurgeStepsPort {
  readonly steps: PurgeStepsByKind = CORE_PURGE_STEPS;

  async runEditionStep(): Promise<PurgeDataResponse> {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'DATA_PURGE_UNKNOWN_STEP',
    });
  }
}
