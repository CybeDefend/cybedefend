import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { lastValueFrom, Observable, throwError, timeout } from 'rxjs';
import type {
  PurgeDataResponse,
  PurgeOrganizationDataRequest,
  PurgeProjectDataRequest,
  PurgeTeamDataRequest,
} from '@grpc/data-purge/data_purge';
import type { DataPurgeServiceClient as AnalysisReportingPurge } from '@grpc/analysis-reporting/data_purge';
import type { DataPurgeServiceClient as SecurityScanningPurge } from '@grpc/security-scanning/data_purge';
import type { DataPurgeServiceClient as FileManagementPurge } from '@grpc/file-management/data_purge';
import type { DataPurgeServiceClient as IntegrationsPurge } from '@grpc/external-integrations/data_purge';
import type { DataPurgeServiceClient as PolicyPurge } from '@grpc/policy-management/data_purge';
import { wrapGrpcClientWithTracing } from 'src/core/grpc/traced-grpc-client';
import type { PurgeStepName } from '../../entities/data-purge-step.entity';
import { PURGE_STEPS } from '../../edition/ports/purge-steps.port';
import type { PurgeStepsPort } from '../../edition/ports/purge-steps.port';
import { PermifyService } from '../permify/permify.service';
import type { PurgeJobRow } from './data-purge.store';

/**
 * How long one purge call may take. A service stops starting new work after
 * 60 s and answers `complete: false`, so its answer comes within 60 s plus
 * one batch; the AI agent bounds its own relay to ingestion at 150 s.
 */
export const PURGE_CALL_TIMEOUT_MS = 170_000;

/** A call of a local step stops starting a batch after this budget. */
export const PURGE_LOCAL_BUDGET_MS = 60_000;

/** Rows per DELETE of a local step. */
export const PURGE_LOCAL_BATCH_SIZE = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATA_PURGE_SERVICE = 'DataPurgeService';

/** A failure that carries a gRPC code and nothing a log could leak. */
function coded(code: status, name: string): Error {
  return Object.assign(new Error(name), { code });
}

/** The DataPurgeService methods every client may hold. */
export interface AnyPurgeClient {
  purgeProjectData?(r: PurgeProjectDataRequest): Observable<PurgeDataResponse>;
  purgeTeamData?(r: PurgeTeamDataRequest): Observable<PurgeDataResponse>;
  purgeOrganizationData?(
    r: PurgeOrganizationDataRequest,
  ): Observable<PurgeDataResponse>;
}

/** The five steps the core calls itself; every other step is the edition's. */
type CoreGrpcStep = Exclude<
  PurgeStepName,
  'permify' | 'marketing' | 'agent' | 'billing'
>;

const isCoreGrpcStep = (step: PurgeStepName): step is CoreGrpcStep =>
  step !== 'permify' &&
  step !== 'marketing' &&
  step !== 'agent' &&
  step !== 'billing';

/**
 * One call of a gRPC step: the DataPurgeService call of the service that owns
 * the data, with the job's ids. Exported for the edition steps that call a
 * closed service's DataPurgeService (agent, billing) — the cloud's
 * CloudPurgeSteps. Every id is checked by the caller before anything is sent.
 */
export async function callPurgeService(
  client: AnyPurgeClient,
  job: PurgeJobRow,
): Promise<PurgeDataResponse> {
  let call: Observable<PurgeDataResponse> | undefined;
  if (job.kind === 'project') {
    call = client.purgeProjectData?.({
      projectId: job.subjectId,
      organizationId: job.organizationId,
    });
  } else if (job.kind === 'team') {
    call = client.purgeTeamData?.({
      teamId: job.subjectId,
      organizationId: job.organizationId,
    });
  } else {
    call = client.purgeOrganizationData?.({
      organizationId: job.organizationId,
      teamIds: [...(job.teamIds ?? [])],
    });
  }
  if (!call) throw coded(status.UNIMPLEMENTED, 'DATA_PURGE_NO_RPC');

  const response = await lastValueFrom(
    call.pipe(
      timeout({
        each: PURGE_CALL_TIMEOUT_MS,
        with: () =>
          throwError(() =>
            coded(status.DEADLINE_EXCEEDED, 'DATA_PURGE_CALL_TIMEOUT'),
          ),
      }),
    ),
  );
  return {
    complete: Boolean(response?.complete),
    deleted: { ...(response?.deleted ?? {}) },
  };
}

/**
 * One call of one step of a purge job: a gRPC call to
 * the DataPurgeService of one of the five core services, a local delete
 * (Permify), or — through the PURGE_STEPS port — a step the core does not own
 * (the closed edition's steps). Every id is checked before anything
 * is sent: an empty or malformed one could reach a WHERE or a bucket prefix
 * downstream. A failure rejects with an error carrying a gRPC code; the
 * runner keeps only the code's name.
 */
@Injectable()
export class DataPurgeSteps implements OnModuleInit {
  private clients!: Record<CoreGrpcStep, AnyPurgeClient>;

  constructor(
    @Inject('ANALYSIS_REPORTING_SERVICE')
    private readonly analysisReporting: ClientGrpc,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly securityScanning: ClientGrpc,
    @Inject('FILE_MANAGEMENT_SERVICE')
    private readonly fileManagement: ClientGrpc,
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly integrations: ClientGrpc,
    @Inject('POLICY_MANAGEMENT_SERVICE')
    private readonly policy: ClientGrpc,
    @Inject(PURGE_STEPS) private readonly purgeSteps: PurgeStepsPort,
    private readonly permify: PermifyService,
  ) {}

  onModuleInit(): void {
    const service = <T extends object>(client: ClientGrpc): T =>
      wrapGrpcClientWithTracing(client.getService<T>(DATA_PURGE_SERVICE));
    this.clients = {
      analysis_reporting: service<AnalysisReportingPurge>(
        this.analysisReporting,
      ),
      security_scanning: service<SecurityScanningPurge>(this.securityScanning),
      file_management: service<FileManagementPurge>(this.fileManagement),
      integrations: service<IntegrationsPurge>(this.integrations),
      policy: service<PolicyPurge>(this.policy),
    };
  }

  async runStep(
    step: PurgeStepName,
    job: PurgeJobRow,
  ): Promise<PurgeDataResponse> {
    assertIds(job);
    if (!this.purgeSteps.steps[job.kind]?.includes(step)) {
      throw coded(status.INVALID_ARGUMENT, 'DATA_PURGE_UNKNOWN_STEP');
    }
    if (step === 'permify') return this.permifyStep(job);
    if (isCoreGrpcStep(step)) {
      return callPurgeService(this.clients[step], job);
    }
    return this.purgeSteps.runEditionStep(step, job);
  }

  /**
   * A project: every relationship its entity still holds (removeProjectFromTeam
   * leaves the `owner` tuples). An organization: its attributes, after billing.
   */
  private async permifyStep(job: PurgeJobRow): Promise<PurgeDataResponse> {
    if (job.kind === 'organization') {
      await this.permify.deleteOrganizationAttributes(job.organizationId);
    } else {
      const deleted = await this.permify.deleteAllPermissions(
        job.subjectId,
        'project',
      );
      if (!deleted) throw coded(status.UNKNOWN, 'DATA_PURGE_PERMIFY_NO_TOKEN');
    }
    return { complete: true, deleted: {} };
  }
}

function assertIds(job: PurgeJobRow): void {
  const ids = [job.subjectId, job.organizationId, ...(job.teamIds ?? [])];
  if (job.teamIds !== null && !Array.isArray(job.teamIds)) {
    throw coded(status.INVALID_ARGUMENT, 'DATA_PURGE_INVALID_ID');
  }
  for (const id of ids) {
    if (typeof id !== 'string' || !UUID.test(id)) {
      throw coded(status.INVALID_ARGUMENT, 'DATA_PURGE_INVALID_ID');
    }
  }
}
