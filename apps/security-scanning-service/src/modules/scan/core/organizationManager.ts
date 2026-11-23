import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import {
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';
import { OrganizationInformationsResponse } from '@grpc/global-management/organization';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import { Span } from 'nestjs-otel';
import { ProjectInformationsResponse } from '@grpc/global-management/project';
import { Repository } from 'typeorm';
import { Scan } from 'src/entities/scan.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { ProjectScanSettings } from '@grpc/security-scanning/scan';
import { holdsScanSlot } from './scanPipeline';
import { readScanPipelineConfig } from './scanPipelineConfig';
import {
  PROJECT_SCAN_SETTINGS_PORT,
  ProjectScanSettingsPort,
} from 'src/edition/ports/project-scan-settings.port';

/**
 * The running scans that hold a scan slot: the platform total, and the count of each organisation.
 */
export interface SlotHoldingScansCount {
  total: number;
  byOrganization: Record<string, number>;
}

@Injectable()
export class OrganizationManager {
  private projectServiceClient!: ProjectServiceClient;
  private organizationServiceClient!: OrganizationServiceClient;
  /**
   * `SCAN_SLOT_RELEASE_ENABLED`, read once. It must have the
   * same value on the security-scanning API (admission) and on its cron
   * (dequeue, stall watchdog).
   */
  private readonly slotReleaseEnabled: boolean;

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
    @InjectRepository(Scan)
    private readonly scanRepository: Repository<Scan>,
    private readonly logger: Logger,
    configService: ConfigService,
    @Inject(PROJECT_SCAN_SETTINGS_PORT)
    private readonly projectScanSettings: ProjectScanSettingsPort,
  ) {
    this.slotReleaseEnabled = readScanPipelineConfig((key) =>
      configService.get<string>(key),
    ).slotReleaseEnabled;
  }

  onModuleInit() {
    this.projectServiceClient =
      this.globalManagementClient.getService<ProjectServiceClient>(
        PROJECT_SERVICE_NAME,
      );
    this.organizationServiceClient =
      this.globalManagementClient.getService<OrganizationServiceClient>(
        ORGANIZATION_SERVICE_NAME,
      );
  }

  /**
   * Get project information including scan types and settings.
   *
   * Every field below is one of the project's own settings (or
   * its parsed branches), so this asks global-management for the lean read:
   * no vulnerability count in analysis-reporting, no integration status, no
   * security context. It is still read on every call (createScan, startScan,
   * the queued and container paths), never cached nor frozen on the scan, so
   * a setting changed during the upload (enabledScanTypes, hasCodeGraph) is
   * the one the scan runs with.
   *
   * @param projectId The project ID to get information for.
   * @returns Object containing project scan settings or an error.
   */
  @Span()
  async getProjectInformation(projectId: string): Promise<ProjectScanSettings> {
    const projectResponse: ProjectInformationsResponse = await safeGrpcCall(
      this.projectServiceClient.get({
        projectId,
        skipVulnerabilityStats: true,
        skipIntegrationStatus: true,
        skipSecurityContext: true,
      }),
    );

    const enabledScanTypes = [];
    if (projectResponse.sastEnabled) enabledScanTypes.push('sast');
    if (projectResponse.iacEnabled) enabledScanTypes.push('iac');
    if (projectResponse.scaEnabled) enabledScanTypes.push('sca');
    if (projectResponse.secretEnabled) enabledScanTypes.push('secret');
    // The edition's own scan types (none in the Community Edition).
    const project = projectResponse as unknown as Record<string, unknown>;
    enabledScanTypes.push(...this.projectScanSettings.extraScanTypes(project));

    const vulnerabilityTypesByScan: { [key: string]: string } = {};
    if (projectResponse.sastEnabled && projectResponse.sastSeverities) {
      vulnerabilityTypesByScan['sast'] =
        projectResponse.sastSeverities.join(',');
    }
    if (projectResponse.iacEnabled && projectResponse.iacSeverities) {
      vulnerabilityTypesByScan['iac'] = projectResponse.iacSeverities.join(',');
    }
    if (projectResponse.scaEnabled && projectResponse.scaSeverities) {
      vulnerabilityTypesByScan['sca'] = projectResponse.scaSeverities.join(',');
    }
    if (
      projectResponse.secretEnabled &&
      projectResponse.secretSeverities?.length
    ) {
      vulnerabilityTypesByScan['secret'] =
        projectResponse.secretSeverities.join(',');
    }

    const sastFastScanEnabled = projectResponse.sastFastScanEnabled;
    const scaDevEnabled = projectResponse.scaDevelopmentDependenciesEnabled;
    const scaTransitiveEnabled =
      projectResponse.scaTransitiveDependenciesEnabled;

    return {
      enabledScanTypes,
      vulnerabilityTypesByScan,
      sastFastScanEnabled,
      organizationId: projectResponse.organizationId,
      scaDevelopmentDependenciesEnabled: scaDevEnabled,
      scaTransitiveDependenciesEnabled: scaTransitiveEnabled,
      containerEnabled: projectResponse.containerEnabled,
      containerSeverities: projectResponse.containerSeverities || [],
      scaReachabilityPriorityEnabled:
        projectResponse.scaReachabilityPriorityEnabled ?? true,
      scaReachabilityStatusEnabled:
        projectResponse.scaReachabilityStatusEnabled ?? true,
      // gm pre-filters parsedBranches to PARSED, so a non-empty list means the
      // project already has a code graph.
      hasCodeGraph: (projectResponse.parsedBranches ?? []).length > 0,
      // A container scan sent without a branch is stored on it.
      referenceBranch: projectResponse.referenceBranch ?? '',
      // The edition's own settings (none in the Community Edition).
      ...this.projectScanSettings.settingsFields(project),
    } as ProjectScanSettings;
  }

  async getOrganizationInformations(
    organizationId: string,
  ): Promise<OrganizationInformationsResponse> {
    return await safeGrpcCall(
      this.organizationServiceClient.get({
        organizationId,
      }),
    );
  }

  /**
   * Admission counts the organisation's slot-holding `running`
   * scans PLUS its `queued` ones; the dequeue (`ScanCron.processQueuedScans`)
   * counts the slot-holding `running` scans only. The asymmetry is
   * INTENTIONAL. Admission counts the queue so a burst cannot jump ahead of
   * scans already waiting; the dequeue must not, or a queued scan would count
   * itself and the queue could never drain. Changing either side alone breaks
   * FIFO. Both sides read the same slot-holding count, so a scan in its AI
   * phase blocks neither.
   *
   * Diff scans are outside the organisation's limit: they are counted
   * neither running nor queued, and `startScan` never queues one. Their own cap is per user
   * (`saveDiffScanWithinQuota`).
   */
  @Span()
  async shouldQueueScan(
    organizationId: string,
    concurrentScanLimit: number,
  ): Promise<boolean> {
    const { byOrganization } =
      await this.getSlotHoldingScansCount(organizationId);
    const queuedScansForOrg = await this.scanRepository.count({
      where: { organizationId, state: 'queued', isDiffScan: false },
    });
    const activeScansForOrg =
      (byOrganization[organizationId] ?? 0) + queuedScansForOrg;

    const shouldQueue = activeScansForOrg >= concurrentScanLimit;

    if (shouldQueue) {
      this.logger.log(
        `Organization ${organizationId} has reached maximum number of concurrent scans (${activeScansForOrg}/${concurrentScanLimit}), scan will be queued - metadata: { organizationId: ${organizationId} }`,
      );
    }

    return shouldQueue;
  }

  /**
   * The `running` scans that hold a scan slot, platform-wide and per
   * organisation: a running
   * scan holds its organisation slot, and its place under the platform cap,
   * until all its scanner containers are closed; its AI phase no longer
   * does. A scan still creating its containers, or an agent-only scan, keeps
   * its slot. With `SCAN_SLOT_RELEASE_ENABLED=false` every running scan
   * counts, which gives back the former numbers.
   *
   * The one count behind every capacity decision: admission
   * (`shouldQueueScan`), the dequeue and the stall watchdog. It loads the
   * running scans with the container fields the rule reads, a handful of
   * rows served by `IDX_scan_state_createAt` and `IDX_container_scanId_status`,
   * and applies the rule in memory. A scan without an organisation counts in
   * the platform total only, and so does a diff scan: it still runs pods,
   * but it is outside every organisation's limit.
   *
   * With `organizationId`, only that organisation's running scans are loaded
   * (`IDX_scan_organizationId_state`), and the total is theirs: admission runs
   * on every StartScan and needs no more. The crons call it without one.
   */
  @Span()
  async getSlotHoldingScansCount(
    organizationId?: string,
  ): Promise<SlotHoldingScansCount> {
    const runningScans = await this.scanRepository.find({
      where: organizationId
        ? { state: 'running', organizationId }
        : { state: 'running' },
      relations: ['containers'],
      select: {
        id: true,
        organizationId: true,
        isDiffScan: true,
        isGraphOnly: true,
        importFormat: true,
        containers: { id: true, status: true, image: true, podName: true },
      },
    });

    const byOrganization: Record<string, number> = {};
    let total = 0;
    for (const scan of runningScans) {
      // A graph-only scan (a repository import) runs no scanner pod: only the
      // agent's parse, which it waits for while `running`. It holds no slot,
      // neither its organisation's nor the platform's.
      if (scan.isGraphOnly) {
        continue;
      }
      // An import scan is a `running` scan with no container: it
      // holds no slot either; the import watchdog owns its lifecycle.
      if (scan.importFormat) {
        continue;
      }
      if (!holdsScanSlot(scan.containers ?? [], this.slotReleaseEnabled)) {
        continue;
      }
      total++;
      if (scan.organizationId && !scan.isDiffScan) {
        byOrganization[scan.organizationId] =
          (byOrganization[scan.organizationId] ?? 0) + 1;
      }
    }

    return { total, byOrganization };
  }

  /**
   * Get an organization's concurrent scan limit
   */
  @Span()
  async getOrganizationConcurrentScanLimit(
    organizationId: string,
  ): Promise<number> {
    const organizationResponse = await safeGrpcCall(
      this.organizationServiceClient.get({
        organizationId: organizationId,
      }),
    );
    return organizationResponse.concurrentScanLimit || 1; // Default to 1 if not set
  }
}
