import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { Span } from 'nestjs-otel';
// Exported discriminated union types used by cron mapping (no "any").
export interface AggregatedVulnBase {
  id: string;
  severity: string; // currentSeverity normalized (lowercase original kept as-is?)
  state: string; // currentState
  createdAt: string; // ISO date
  // Git branch the detection was scanned on (nullable in DB → optional here).
  // Threaded through to the report mails so they can group/label by branch.
  branch?: string;
}
export interface AggregatedSastVuln extends AggregatedVulnBase {
  type: 'SAST';
  title: string; // vulnerability.name or fallback path
}
export interface AggregatedIacVuln extends AggregatedVulnBase {
  type: 'IAC';
  title: string; // vulnerability.name or fallback path
}
export interface AggregatedSecretVuln extends AggregatedVulnBase {
  type: 'SECRET';
  title: string; // vulnerability.name or fallback path
}
export interface AggregatedCicdVuln extends AggregatedVulnBase {
  type: 'CICD';
  title: string; // vulnerability.name or fallback path
}
export interface AggregatedScaVuln extends AggregatedVulnBase {
  type: 'SCA';
  title: string; // vulnerability id or package
  packageName?: string;
  version?: string;
  cvss?: string; // first severity score
}
export interface AggregatedContainerVuln extends AggregatedVulnBase {
  type: 'CONTAINER';
  title: string; // vulnerabilityIdentifier
  packageName?: string; // detected package name
  version?: string; // installed version (detectedPackage.version or fixedVersion)
  cvss?: string; // cvssScore if >0
}
export type AggregatedVuln =
  | AggregatedSastVuln
  | AggregatedIacVuln
  | AggregatedScaVuln
  | AggregatedContainerVuln
  | AggregatedSecretVuln
  | AggregatedCicdVuln;

export interface PriorityBreakdownInternal {
  criticalUrgent: number;
  urgent: number;
  normal: number;
  low: number;
  veryLow: number;
}

export interface MttrMetricsInternal {
  mttrHoursOverall: number;
  mttrHoursCritical: number;
  mttrHoursHigh: number;
  mttrHoursMedium: number;
  mttrHoursLow: number;
}

export interface CommonAggregationFields {
  projectId: string;
  projectName: string;
  severities: { critical: number; high: number; medium: number; low: number };
  types: { sast: number; iac: number; sca: number; container: number };
  topRecent: AggregatedVuln[];
  total: number;
  topCriticalPerType: {
    sast: AggregatedSastVuln[];
    iac: AggregatedIacVuln[];
    sca: AggregatedScaVuln[];
    container: AggregatedContainerVuln[];
  };
  priorities: PriorityBreakdownInternal;
  mttr?: MttrMetricsInternal; // placeholder (can be undefined until implemented)
}

export interface WeeklyProjectReportAggregation extends CommonAggregationFields {
  newLast7d: number;
  resolvedLast7d: number;
}

export interface MonthlyProjectReportAggregation extends CommonAggregationFields {
  newLast30d: number;
  resolvedLast30d: number;
}
export interface DailyCriticalAlertsAggregation {
  projectId: string;
  projectName: string;
  criticals: AggregatedVuln[];
}

/**
 * Vulnerability states that represent a triaged-away finding: a false positive
 * (`ignored`), a fixed issue (`resolved`), or one judged not exploitable
 * (`not_exploitable`, a legacy state remapped to `ignored` by migration
 * 1803000000000 but kept here defensively). Reports and alert emails must never
 * surface these — this mirrors the dashboard org-overview, which excludes them
 * from the active vulnerability counts.
 */
const NON_REPORTABLE = ['ignored', 'resolved', 'not_exploitable'];
const NON_REPORTABLE_STATES = new Set(NON_REPORTABLE);

// NOTE: Initial naive implementation; can be optimized with raw SQL aggregation later.
@Injectable()
export class ReportAggregationService {
  constructor(
    @InjectRepository(SastVulnerabilityDetections)
    private readonly sastRepo: Repository<SastVulnerabilityDetections>,
    @InjectRepository(IacVulnerabilityDetections)
    private readonly iacRepo: Repository<IacVulnerabilityDetections>,
    @InjectRepository(ScaVulnerabilityDetections)
    private readonly scaRepo: Repository<ScaVulnerabilityDetections>,
    @InjectRepository(VulnerabilityDetectionsContainer)
    private readonly containerRepo: Repository<VulnerabilityDetectionsContainer>,
    @InjectRepository(VulnerabilityDetectionHistory)
    private readonly historyRepo: Repository<VulnerabilityDetectionHistory>,
    @InjectRepository(SecretVulnerabilityDetections)
    private readonly secretRepo: Repository<SecretVulnerabilityDetections>,
    @InjectRepository(CicdVulnerabilityDetections)
    private readonly cicdRepo: Repository<CicdVulnerabilityDetections>,
  ) {}

  /**
   * A vulnerability is worth reporting only while it sits in an active state.
   * Triaged-away states (ignored / resolved / not_exploitable) are muted so
   * false positives and fixed issues never reach the alert/report emails.
   */
  private isReportableState(state: string): boolean {
    return !NON_REPORTABLE_STATES.has((state || '').toLowerCase());
  }

  /**
   * A finding of an archived branch is never reported: the customer no
   * longer ships that branch. A finding without a branch is kept.
   */
  private isOnLiveBranch(
    v: AggregatedVuln,
    archivedBranches: ReadonlySet<string>,
  ): boolean {
    return !v.branch || !archivedBranches.has(v.branch);
  }

  private mapSast(v: SastVulnerabilityDetections): AggregatedSastVuln {
    return {
      id: v.id,
      type: 'SAST',
      title: v.vulnerability?.name || v.path || 'SAST Issue',
      severity: (v.effectiveSeverity ?? v.currentSeverity) || 'unknown',
      state: v.currentState || 'unknown',
      createdAt: v.createdAt?.toISOString?.() || new Date().toISOString(),
      branch: v.branch || undefined,
    };
  }

  private mapIac(v: IacVulnerabilityDetections): AggregatedIacVuln {
    return {
      id: v.id,
      type: 'IAC',
      title: v.vulnerability?.name || v.path || 'IaC Issue',
      severity: (v.effectiveSeverity ?? v.currentSeverity) || 'unknown',
      state: v.currentState || 'unknown',
      createdAt: v.createdAt?.toISOString?.() || new Date().toISOString(),
      branch: v.branch || undefined,
    };
  }

  private mapSecret(v: SecretVulnerabilityDetections): AggregatedSecretVuln {
    return {
      id: v.id,
      type: 'SECRET',
      title: v.vulnerability?.name || v.path || 'Secret',
      severity: (v.effectiveSeverity ?? v.currentSeverity) || 'unknown',
      state: v.currentState || 'unknown',
      createdAt: v.createdAt?.toISOString?.() || new Date().toISOString(),
      branch: v.branch || undefined,
    };
  }

  private mapCicd(v: CicdVulnerabilityDetections): AggregatedCicdVuln {
    return {
      id: v.id,
      type: 'CICD',
      title: v.vulnerability?.name || v.path || 'CI/CD Issue',
      severity: (v.effectiveSeverity ?? v.currentSeverity) || 'unknown',
      state: v.currentState || 'unknown',
      createdAt: v.createdAt?.toISOString?.() || new Date().toISOString(),
      branch: v.branch || undefined,
    };
  }

  /**
   * Every finding of the project, of every type the instance stores, mapped
   * for the reports. The secret and CI/CD tables leave the muted states out
   * in the query; the callers filter the muted states of the other tables
   * and the archived branches.
   */
  private async loadAll(projectId: string): Promise<AggregatedVuln[]> {
    const [sastAll, iacAll, scaAll, containerAll, secretAll, cicdAll] =
      await Promise.all([
        this.sastRepo.find({
          where: { projectId },
          relations: ['vulnerability'],
        }),
        this.iacRepo.find({
          where: { projectId },
          relations: ['vulnerability'],
        }),
        this.scaRepo.find({
          where: { projectId },
          relations: ['vulnerability', 'scaDetectedPackage'],
        }),
        this.containerRepo.find({
          where: { projectId },
          relations: ['vulnerability', 'detectedPackage', 'detectedImage'],
        }),
        this.secretRepo.find({
          where: { projectId, currentState: Not(In(NON_REPORTABLE)) },
          relations: ['vulnerability'],
        }),
        this.cicdRepo.find({
          where: { projectId, currentState: Not(In(NON_REPORTABLE)) },
          relations: ['vulnerability'],
        }),
      ]);
    return [
      ...sastAll.map((v) => this.mapSast(v)),
      ...iacAll.map((v) => this.mapIac(v)),
      ...scaAll.map((v) => this.mapSca(v)),
      ...containerAll.map((v) => this.mapContainer(v)),
      ...secretAll.map((v) => this.mapSecret(v)),
      ...cicdAll.map((v) => this.mapCicd(v)),
    ];
  }

  private mapSca(v: ScaVulnerabilityDetections): AggregatedScaVuln {
    let cvss: string | undefined;
    const sevEntry: any = (v as any).vulnerability?.severities?.[0];
    if (sevEntry?.score) cvss = String(sevEntry.score);
    return {
      id: v.id,
      type: 'SCA',
      title:
        (v as any).vulnerability?.id ||
        v.scaDetectedPackage?.packageName ||
        'SCA Package',
      severity: (v.effectiveSeverity ?? v.currentSeverity) || 'unknown',
      state: v.currentState || 'unknown',
      createdAt: v.createdAt?.toISOString?.() || new Date().toISOString(),
      branch: v.branch || undefined,
      packageName: v.scaDetectedPackage?.packageName,
      version: v.scaDetectedPackage?.packageVersion,
      cvss,
    };
  }

  private mapContainer(
    v: VulnerabilityDetectionsContainer,
  ): AggregatedContainerVuln {
    return {
      id: v.id,
      type: 'CONTAINER',
      title:
        v.vulnerabilityIdentifier ||
        v.detectedPackage?.packageName ||
        'Container Vuln',
      severity: (v.effectiveSeverity ?? v.currentSeverity) || 'unknown',
      state: v.currentState || 'unknown',
      createdAt: v.createdAt?.toISOString?.() || new Date().toISOString(),
      branch: v.branch || undefined,
      packageName: v.detectedPackage?.packageName,
      version: v.detectedPackage?.packageVersion || v.fixedVersion,
      cvss: v.cvssScore ? String(v.cvssScore) : undefined,
    };
  }

  private computePriorityBreakdown(
    list: AggregatedVuln[],
  ): PriorityBreakdownInternal {
    const pb: PriorityBreakdownInternal = {
      criticalUrgent: 0,
      urgent: 0,
      normal: 0,
      low: 0,
      veryLow: 0,
    };
    // We need priority info -> currently only present on detection entities; map by id lookup for speed
    // For simplicity (and to avoid re-query), we approximate by severity mapping if explicit priority not easily accessible.
    // TODO: Replace with real currentPriority per detection (extend mapping functions to include priority field plainly).
    list.forEach((v) => {
      switch (v.severity.toLowerCase()) {
        case 'critical':
          pb.criticalUrgent++;
          break;
        case 'high':
          pb.urgent++;
          break;
        case 'medium':
          pb.normal++;
          break;
        case 'low':
          pb.low++;
          break;
        default:
          pb.veryLow++;
      }
    });
    return pb;
  }

  private buildTopCriticalPerType(all: AggregatedVuln[]) {
    const isCritical = (v: AggregatedVuln) =>
      v.severity.toLowerCase() === 'critical';
    return {
      sast: all
        .filter(
          (v): v is AggregatedSastVuln => v.type === 'SAST' && isCritical(v),
        )
        .slice(0, 5),
      iac: all
        .filter(
          (v): v is AggregatedIacVuln => v.type === 'IAC' && isCritical(v),
        )
        .slice(0, 5),
      sca: all
        .filter(
          (v): v is AggregatedScaVuln => v.type === 'SCA' && isCritical(v),
        )
        .slice(0, 5),
      container: all
        .filter(
          (v): v is AggregatedContainerVuln =>
            v.type === 'CONTAINER' && isCritical(v),
        )
        .slice(0, 5),
    };
  }

  @Span()
  async aggregateWeekly(
    projectId: string,
    projectName: string,
    archivedBranches: ReadonlySet<string> = new Set(),
  ): Promise<WeeklyProjectReportAggregation> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const all: AggregatedVuln[] = (await this.loadAll(projectId)).filter(
      (v) =>
        this.isReportableState(v.state) &&
        this.isOnLiveBranch(v, archivedBranches),
    );
    const severities = { critical: 0, high: 0, medium: 0, low: 0 };
    all.forEach((v) => {
      const s = v.severity.toLowerCase();
      if (s in severities) (severities as any)[s]++;
    });
    const types = {
      sast: all.filter((v) => v.type === 'SAST').length,
      iac: all.filter((v) => v.type === 'IAC').length,
      sca: all.filter((v) => v.type === 'SCA').length,
      container: all.filter((v) => v.type === 'CONTAINER').length,
    };
    const newLast7d = all.filter(
      (v) => new Date(v.createdAt) >= sevenDaysAgo,
    ).length;
    // TODO V2 resolvedLast7d using history states transitions
    // Return top 5 most recent vulnerabilities for email display
    const topRecent = [...all]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);
    return {
      projectId,
      projectName,
      severities,
      types,
      topRecent,
      total: all.length,
      newLast7d,
      resolvedLast7d: 0,
      topCriticalPerType: this.buildTopCriticalPerType(all),
      priorities: this.computePriorityBreakdown(all),
      mttr: undefined,
    };
  }

  @Span()
  async aggregateMonthly(
    projectId: string,
    projectName: string,
    archivedBranches: ReadonlySet<string> = new Set(),
  ): Promise<MonthlyProjectReportAggregation> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const all: AggregatedVuln[] = (await this.loadAll(projectId)).filter(
      (v) =>
        this.isReportableState(v.state) &&
        this.isOnLiveBranch(v, archivedBranches),
    );
    const severities = { critical: 0, high: 0, medium: 0, low: 0 };
    all.forEach((v) => {
      const s = v.severity.toLowerCase();
      if (s in severities) (severities as any)[s]++;
    });
    const types = {
      sast: all.filter((v) => v.type === 'SAST').length,
      iac: all.filter((v) => v.type === 'IAC').length,
      sca: all.filter((v) => v.type === 'SCA').length,
      container: all.filter((v) => v.type === 'CONTAINER').length,
    };
    const newLast30d = all.filter(
      (v) => new Date(v.createdAt) >= thirtyDaysAgo,
    ).length;
    // Return top 5 most recent vulnerabilities for email display
    const topRecent = [...all]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);
    return {
      projectId,
      projectName,
      severities,
      types,
      topRecent,
      total: all.length,
      newLast30d,
      resolvedLast30d: 0,
      topCriticalPerType: this.buildTopCriticalPerType(all),
      priorities: this.computePriorityBreakdown(all),
      mttr: undefined,
    };
  }

  @Span()
  async aggregateDailyCritical(
    projectId: string,
    projectName: string,
    archivedBranches: ReadonlySet<string> = new Set(),
  ): Promise<DailyCriticalAlertsAggregation> {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const critical = (arr: AggregatedVuln[]) =>
      arr.filter((v) => v.severity.toLowerCase() === 'critical');
    const all: AggregatedVuln[] = (await this.loadAll(projectId)).filter(
      (v) =>
        new Date(v.createdAt) >= dayAgo &&
        this.isReportableState(v.state) &&
        this.isOnLiveBranch(v, archivedBranches),
    );
    const crits = critical(all);
    return {
      projectId,
      projectName,
      criticals: crits,
    };
  }
}
