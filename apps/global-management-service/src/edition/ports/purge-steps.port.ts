import type { PurgeDataResponse } from '@grpc/data-purge/data_purge';
import type { PurgeKind } from '../../entities/data-purge-job.entity';
import type { PurgeStepName } from '../../entities/data-purge-step.entity';
import type { PurgeJobRow } from '../../modules/data-purge/data-purge.store';

/**
 * The purge-steps port: which steps a purge job of each kind runs,
 * and how a step the core does not own runs. The core runs the five core
 * services' DataPurgeService itself and Permify locally; everything else
 * (agent, billing, marketing) is the edition's.
 *
 * Community: CORE_PURGE_STEPS (no AI agent relay, no billing, no marketing
 * leads — their table is closed), and runEditionStep refuses
 * INVALID_ARGUMENT 'DATA_PURGE_UNKNOWN_STEP'. Cloud: CLOUD_PURGE_STEPS, with
 * the closed clients and the lead table behind runEditionStep.
 */
export const PURGE_STEPS = 'PURGE_STEPS';

export type PurgeStepsByKind = Readonly<
  Record<PurgeKind, readonly PurgeStepName[]>
>;

export interface PurgeStepsPort {
  /** Every step of each kind, in insertion order. Community: CORE_PURGE_STEPS. Cloud: CLOUD_PURGE_STEPS. */
  readonly steps: PurgeStepsByKind;
  /** Runs a step the core does not own (agent, billing, marketing). Community: rejects INVALID_ARGUMENT 'DATA_PURGE_UNKNOWN_STEP'. */
  runEditionStep(
    step: PurgeStepName,
    job: PurgeJobRow,
  ): Promise<PurgeDataResponse>;
}
