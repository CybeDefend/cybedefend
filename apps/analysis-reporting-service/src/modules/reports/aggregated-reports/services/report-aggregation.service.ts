import { Injectable, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { SastVulnerabilityDetections } from '../../../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../../../entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from '../../../../entities/container_vulnerability_detections.entity';
import { installedAwareContainerFix } from '../../../container/container.mapper';
import { ScaDetectedPackages } from '../../../../entities/sca-detected-packages.entity';
import { ScaLicenseOverride } from '../../../../entities/sca-license-override.entity';
import { OWASP_TOP_10_2021_DATA } from '../../owasp-report/constants/owasp-data.constants';
import { CWE_TOP_25_2024_DATA } from '../../cwe-report/constants/cwe-data.constants';
import { advisoryCwes } from '../../shared/report-findings';
import {
  getHighestRiskCategory,
  getLicenseInfo,
  LicenseCategory,
} from '../../../sca/license.utils';
import { getEffectiveLicenses } from '../../../sca/spdx-expression.utils';
import { getMinFixedAbove } from '../../../sca/sca.utils';
import type { ImportedAdvisoryFix } from '../../../../entities/imported-advisory.entity';
import {
  applyImportedAdvisories,
  catalogueAdvisoryIds,
  cveOfFinding,
  fixesOfFinding,
  loadCatalogueCveAliases,
  loadCatalogueFixes,
} from '../../../results-import/imported-advisory.view';

/** The package of an SCA finding, as the advisory reads compare it. */
const scaPackageOf = (d: ScaVulnerabilityDetections) =>
  d.scaDetectedPackage
    ? {
        packageName: d.scaDetectedPackage.packageName,
        ecosystem: d.scaDetectedPackage.ecosystem,
      }
    : null;

interface MappedVulnerability {
  id: string;
  type: 'sast' | 'iac' | 'sca' | 'container';
  name: string;
  description: string;
  severity: string;
  state: string;
  priority: string;
  language?: string;
  path?: string;
  line?: string;
  packageName?: string;
  packageVersion?: string;
  fixedVersion?: string;
  cvssScore?: number;
  cve?: string;
  /** Advisory identifier (OSV id for SCA, CVE/GHSA for containers). */
  advisoryId?: string;
  /** Advisory withdrawn by its publisher (OSV record), still counted. */
  withdrawn?: boolean;
  /** Image a container finding was found in (its artifact name). */
  image?: string;
  cwe: string[];
  owaspTop10?: string[];
  createdAt: Date;
  updatedAt: Date;
  projectId: string;
  projectName: string;
  branch: string;
}

/**
 * Interface for project branch metadata used in reports
 */
interface ProjectBranchMetadata {
  projectId: string;
  projectName: string;
  teamId: string;
  teamName: string;
  branch: string;
  vulnerabilitiesCount: number;
}

/**
 * License identifiers some registries publish outside the SPDX spelling
 * (`AFLv2.1`, `Apache 2.0`…). Normalised before categorisation so a well-known
 * permissive license is not reported as "unknown".
 */
const LICENSE_ALIASES: {
  pattern: RegExp;
  spdx: (m: RegExpExecArray) => string;
}[] = [
  { pattern: /^AFLv?(\d\.\d)$/i, spdx: (m) => `AFL-${m[1]}` },
  {
    pattern: /^Apache[\s-]*(?:License[\s-]*)?v?2(?:\.0)?$/i,
    spdx: () => 'Apache-2.0',
  },
  { pattern: /^MIT[\s-]+License$/i, spdx: () => 'MIT' },
];

function normalizeLicenseId(raw: string): string {
  const id = String(raw ?? '').trim();
  for (const alias of LICENSE_ALIASES) {
    const match = alias.pattern.exec(id);
    if (match) return alias.spdx(match);
  }
  return id;
}

function normalizeLicenseExpression(expression: string): string {
  return expression.replace(/\bAFLv(\d\.\d)\b/gi, 'AFL-$1');
}

/** Registries read by the SCA scans under two names. */
const ECOSYSTEM_ALIASES: Record<string, string> = { github: 'github_actions' };

function normalizeEcosystem(raw: string): string {
  const eco = String(raw ?? '').trim();
  return ECOSYSTEM_ALIASES[eco.toLowerCase()] ?? eco;
}

/** A pinned requirement (`==0.3.0`) is the version it pins. */
function normalizePackageVersion(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^={2,3}\s*/, '');
}

/**
 * A GitHub Action referenced by its major tag (`v2`) and by the version the
 * tag resolved to (`2.0.0`) is one version: the tag is merged into it.
 */
function mergeActionTags(
  entries: Map<
    string,
    {
      ecosystem: string;
      packageName: string;
      packageVersion: string;
      projectSet: Set<string>;
      branchSet: Set<string>;
      projectIdSet: Set<string>;
      isDev: boolean;
      isTransitive: boolean;
    }
  >,
): void {
  for (const [key, tag] of entries) {
    const major = /^v?(\d+)$/i.exec(tag.packageVersion)?.[1];
    if (tag.ecosystem !== 'github_actions' || !major) continue;
    const resolved = Array.from(entries.values()).find(
      (e) =>
        e !== tag &&
        e.ecosystem === tag.ecosystem &&
        e.packageName === tag.packageName &&
        e.packageVersion.startsWith(`${major}.`),
    );
    if (!resolved) continue;
    tag.projectSet.forEach((p) => resolved.projectSet.add(p));
    tag.branchSet.forEach((b) => resolved.branchSet.add(b));
    tag.projectIdSet.forEach((p) => resolved.projectIdSet.add(p));
    resolved.isDev = resolved.isDev && tag.isDev;
    resolved.isTransitive = resolved.isTransitive && tag.isTransitive;
    entries.delete(key);
  }
}

/** License categories, most restrictive first. */
const CATEGORY_RANK: Record<LicenseCategory, number> = {
  [LicenseCategory.STRONG_COPYLEFT]: 0,
  [LicenseCategory.WEAK_COPYLEFT]: 1,
  [LicenseCategory.UNKNOWN]: 2,
  [LicenseCategory.PERMISSIVE]: 3,
};

/**
 * Service responsible for aggregating vulnerabilities from multiple projects.
 * Handles fetching project hierarchies from GlobalManagement and consolidating vulnerability data.
 */
@Injectable()
export class ReportAggregationService {
  private projectServiceClient: any;
  private organizationServiceClient: any;
  private teamServiceClient: any;

  constructor(
    @InjectRepository(SastVulnerabilityDetections)
    private readonly sastVulnDetectRepository: Repository<SastVulnerabilityDetections>,
    @InjectRepository(IacVulnerabilityDetections)
    private readonly iacVulnDetectRepository: Repository<IacVulnerabilityDetections>,
    @InjectRepository(ScaVulnerabilityDetections)
    private readonly scaVulnDetectRepository: Repository<ScaVulnerabilityDetections>,
    @InjectRepository(VulnerabilityDetectionsContainer)
    private readonly containerVulnDetectRepository: Repository<VulnerabilityDetectionsContainer>,
    @InjectRepository(ScaDetectedPackages)
    private readonly scaDetectedPackagesRepository: Repository<ScaDetectedPackages>,
    @InjectRepository(ScaLicenseOverride)
    private readonly scaLicenseOverrideRepository: Repository<ScaLicenseOverride>,
    @Inject('GLOBAL_MANAGEMENT_SERVICE') private readonly client: ClientGrpc,
    private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.projectServiceClient = this.client.getService('ProjectService');
    this.organizationServiceClient = this.client.getService(
      'OrganizationService',
    );
    this.teamServiceClient = this.client.getService('TeamService');
  }

  /**
   * Get all project IDs for an organization using GetAllFromOrganization
   */
  @Span()
  async getOrganizationProjects(
    organizationId: string,
    userId: string,
  ): Promise<string[]> {
    try {
      this.logger.log(
        `Fetching all projects for organization ${organizationId}`,
      );

      const response = await this.projectServiceClient
        .GetAllFromOrganization({
          teamId: organizationId, // Proto uses teamId field for organizationId
          pageNumber: 1,
          pageSizeNumber: 10000,
          searchQuery: '',
          userId,
        })
        .toPromise();

      const projectIds = response.projects?.map((p: any) => p.projectId) || [];
      this.logger.log(
        `Found ${projectIds.length} projects for organization ${organizationId}`,
      );

      return projectIds;
    } catch (error) {
      this.logger.error(
        `Failed to fetch organization projects: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        'Failed to fetch organization projects',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all project IDs for a team using GetAllFromTeam
   */
  @Span()
  async getTeamProjects(teamId: string, userId: string): Promise<string[]> {
    try {
      this.logger.log(`Fetching all projects for team ${teamId}`);

      const response = await this.projectServiceClient
        .GetAllFromTeam({
          teamId,
          pageNumber: 1,
          pageSizeNumber: 10000,
          searchQuery: '',
          userId,
        })
        .toPromise();

      const projectIds = response.projects?.map((p: any) => p.projectId) || [];
      this.logger.log(`Found ${projectIds.length} projects for team ${teamId}`);

      return projectIds;
    } catch (error) {
      this.logger.error(
        `Failed to fetch team projects: ${error.message}`,
        error.stack,
      );
      // The failed call stays the cause so a caller can still read its
      // gRPC code (a missing team is not an outage).
      throw new HttpException(
        'Failed to fetch team projects',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { cause: error },
      );
    }
  }

  /**
   * Validate that every requested project belongs to the supplied organization.
   *
   * Defense in depth: the gateway already runs per-project Permify checks,
   * but this service must NEVER silently trust gateway claims. A malicious
   * caller hitting analysis-reporting-service directly (bypassing the gateway,
   * e.g. via gRPC) could otherwise obtain another tenant's data.
   *
   * The check is org-mismatch based (no Permify dependency in this service):
   *   - Resolve each projectId via global-management `ProjectService.Get`
   *   - Reject the entire batch if ANY project's `organizationId` differs
   *     from the requested `organizationId`
   *   - Also reject if the project cannot be resolved (fail-closed)
   *
   * Error messages must NOT contain projectIds — they would enable
   * enumeration of which IDs exist across tenants.
   */
  @Span()
  async validateUserAccess(
    userId: string,
    projectIds: string[],
    organizationId: string,
  ): Promise<void> {
    this.logger.log(
      `Validating user ${userId} access to ${projectIds.length} projects (org=${organizationId})`,
    );

    if (!organizationId) {
      // Without an org context we cannot enforce the cross-tenant boundary.
      // Refuse rather than skip the check.
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'organizationId is required for batch report access checks',
      });
    }

    if (projectIds.length === 0) {
      return;
    }

    // Resolve every project and verify its organizationId matches.
    // We use the existing `ProjectService.Get` gRPC which returns
    // ProjectInformationsResponse { projectId, organizationId, ... }.
    const results = await Promise.all(
      projectIds.map(async (projectId) => {
        try {
          const response = await this.projectServiceClient
            .Get({ projectId })
            .toPromise();
          return {
            projectId,
            organizationId: response?.organizationId ?? null,
            resolved: true,
          };
        } catch (err: any) {
          this.logger.warn(
            `validateUserAccess: failed to resolve project ${projectId}: ${err?.message || err}`,
          );
          return { projectId, organizationId: null, resolved: false };
        }
      }),
    );

    const offending = results.find(
      (r) => !r.resolved || r.organizationId !== organizationId,
    );
    if (offending) {
      // Generic message — never leak which projectId failed (enumeration).
      this.logger.warn(
        `validateUserAccess: cross-tenant or unresolved project detected for user ${userId} (offending=${offending.projectId})`,
      );
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Access denied to one or more requested projects',
      });
    }
  }

  /**
   * Get organization metadata
   */
  @Span()
  async getOrganizationMetadata(organizationId: string): Promise<any> {
    try {
      const response = await this.organizationServiceClient
        .Get({ organizationId })
        .toPromise();

      return {
        id: response.id,
        name: response.name,
        createdAt: response.createdAt,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch organization metadata: ${error.message}`,
      );
      return {
        id: organizationId,
        name: 'Unknown Organization',
        createdAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Get team metadata
   */
  @Span()
  /**
   * Anti-IDOR — assert the team belongs to `organizationId` before a
   * team report is enqueued/tagged under that org. global-management's getTeam
   * scopes the lookup by (teamId AND organizationId) and throws NOT_FOUND
   * otherwise, so a spoofed org (a team the caller legitimately manages, but
   * tagged to a DIFFERENT org via the client-supplied query param) is rejected
   * here — it must never consume or surface the victim org's report quota/list.
   */
  async assertTeamInOrg(teamId: string, organizationId: string): Promise<void> {
    try {
      await this.teamServiceClient
        .getTeam({ teamId, organizationId })
        .toPromise();
    } catch (err) {
      this.logger.warn(
        `assertTeamInOrg: team ${teamId} does not belong to org ${organizationId}: ${(err as Error)?.message ?? err}`,
      );
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Team does not belong to the specified organization',
      });
    }
  }

  async getTeamMetadata(teamId: string): Promise<any> {
    try {
      const response = await this.teamServiceClient
        .getTeam({ teamId })
        .toPromise();

      return {
        id: response.teamId,
        name: response.name,
        createdAt: response.createdAt,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch team metadata: ${error.message}`);
      return {
        id: teamId,
        name: 'Unknown Team',
        createdAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Get metadata for multiple projects
   */
  @Span()
  async getProjectsMetadata(projectIds: string[]): Promise<any[]> {
    try {
      const projects = await Promise.all(
        projectIds.map(async (projectId) => {
          try {
            const response = await this.projectServiceClient
              .Get({ projectId })
              .toPromise();
            return {
              id: response.projectId,
              name: response.name,
              teamId: response.teamId,
              teamName: response.teamName,
              referenceBranch: response.referenceBranch || null,
            };
          } catch {
            return {
              id: projectId,
              name: 'Unknown Project',
              teamId: '',
              teamName: '',
              referenceBranch: null,
            };
          }
        }),
      );
      return projects;
    } catch (error) {
      this.logger.error(`Failed to fetch projects metadata: ${error.message}`);
      return projectIds.map((id) => ({
        id,
        name: 'Unknown Project',
        teamId: '',
        teamName: '',
        referenceBranch: null,
      }));
    }
  }

  /**
   * Aggregate vulnerabilities from multiple projects
   * Groups vulnerabilities by project and branch for cleaner report display
   * @param branchFilter - "all" (default) includes all branches, "reference" includes only the reference branch of each project, "selected" includes only specified per-project branches
   * @param projectBranchSelections - Per-project branch selections when branchFilter is "selected"
   */
  @Span()
  async aggregateVulnerabilities(
    projectIds: string[],
    reportType: string,
    branchFilter: string = 'all',
    projectBranchSelections: { projectId: string; branches: string[] }[] = [],
  ): Promise<any> {
    this.logger.log(
      `Aggregating ${reportType} vulnerabilities for ${projectIds.length} projects`,
    );

    // Fetch all vulnerabilities for all projects
    const [sastVulns, iacVulns, scaVulns, containerVulns] = await Promise.all([
      this.sastVulnDetectRepository
        .createQueryBuilder('sast')
        .leftJoinAndSelect('sast.vulnerability', 'vulnerability')
        .leftJoinAndSelect('sast.codeSnippets', 'codeSnippets')
        .leftJoinAndSelect('sast.historyItems', 'historyItems')
        .where('sast.projectId IN (:...projectIds)', { projectIds })
        .getMany(),
      this.iacVulnDetectRepository
        .createQueryBuilder('iac')
        .leftJoinAndSelect('iac.vulnerability', 'vulnerability')
        .leftJoinAndSelect('iac.codeSnippets', 'codeSnippets')
        .leftJoinAndSelect('iac.historyItems', 'historyItems')
        .where('iac.projectId IN (:...projectIds)', { projectIds })
        .getMany(),
      this.scaVulnDetectRepository
        .createQueryBuilder('sca')
        .leftJoinAndSelect('sca.scaDetectedPackage', 'scaDetectedPackage')
        .leftJoinAndSelect('sca.vulnerability', 'vulnerability')
        .where('sca.projectId IN (:...projectIds)', { projectIds })
        .getMany(),
      this.containerVulnDetectRepository
        .createQueryBuilder('container')
        .leftJoinAndSelect('container.detectedPackage', 'detectedPackage')
        .leftJoinAndSelect('container.detectedImage', 'detectedImage')
        .leftJoinAndSelect('container.vulnerability', 'vulnerability')
        .where('container.projectId IN (:...projectIds)', { projectIds })
        .getMany(),
    ]);

    // Get project metadata
    const projectsMetadata = await this.getProjectsMetadata(projectIds);
    const projectMetaMap = new Map(projectsMetadata.map((p) => [p.id, p]));
    // Each finding's imported advisory is read from its own project's row
    // (one lookup for every project); the catalogue's CVE aliases and fixes
    // are read once for the other advisories.
    const manager = this.scaVulnDetectRepository.manager;
    await applyImportedAdvisories(manager, scaVulns, scaPackageOf);
    await applyImportedAdvisories(manager, containerVulns, (d) =>
      d.detectedPackage
        ? { packageName: d.detectedPackage.packageName, ecosystem: '' }
        : null,
    );
    const scaFixedVersions = await this.loadScaFixedVersions(
      catalogueAdvisoryIds(scaVulns.map((v) => v.vulnerability)),
    );
    const catalogueCves = await this.loadCatalogueCves(
      catalogueAdvisoryIds([
        ...scaVulns.map((v) => v.vulnerability),
        ...containerVulns.map((v) => v.vulnerability),
      ]),
    );

    // Map all vulnerabilities
    let allVulnerabilities: MappedVulnerability[] = [
      ...sastVulns.map((v) =>
        this.mapSastVulnerability(v, projectMetaMap.get(v.projectId)?.name),
      ),
      ...iacVulns.map((v) =>
        this.mapIacVulnerability(v, projectMetaMap.get(v.projectId)?.name),
      ),
      ...scaVulns.map((v) =>
        this.mapScaVulnerability(
          v,
          projectMetaMap.get(v.projectId)?.name,
          fixesOfFinding(v.vulnerability, scaPackageOf(v), scaFixedVersions),
          catalogueCves,
        ),
      ),
      ...containerVulns.map((v) =>
        this.mapContainerVulnerability(
          v,
          projectMetaMap.get(v.projectId)?.name,
          catalogueCves,
        ),
      ),
    ];

    // When "all" branches selected, exclude archived branches
    if (branchFilter === 'all') {
      const archivedMap = new Map<string, Set<string>>();
      await Promise.all(
        projectIds.map(async (projectId) => {
          try {
            const res = await this.projectServiceClient
              .getArchivedBranches({ projectId })
              .toPromise();
            if (res.branches && res.branches.length > 0) {
              archivedMap.set(projectId, new Set(res.branches));
            }
          } catch {
            // If we can't fetch archived branches, don't filter
          }
        }),
      );

      if (archivedMap.size > 0) {
        const totalBefore = allVulnerabilities.length;
        allVulnerabilities = allVulnerabilities.filter((vuln) => {
          const archived = archivedMap.get(vuln.projectId);
          if (!archived) return true;
          return !archived.has(vuln.branch);
        });
        this.logger.log(
          `Branch filter "all": excluded archived branches, filtered ${totalBefore} -> ${allVulnerabilities.length} vulnerabilities`,
        );
      }
    }

    // Apply branch filter if "reference" mode is selected
    if (branchFilter === 'reference') {
      const referenceBranchMap = new Map<string, string>();
      for (const meta of projectsMetadata) {
        if (meta.referenceBranch) {
          referenceBranchMap.set(meta.id, meta.referenceBranch);
        }
      }

      const totalBefore = allVulnerabilities.length;
      allVulnerabilities = allVulnerabilities.filter((vuln) => {
        const refBranch = referenceBranchMap.get(vuln.projectId);
        // If no reference branch is set for the project, include all branches
        // for that project. A finding recorded without a branch (legacy scan)
        // cannot be placed on another branch: keep it.
        if (!refBranch || !vuln.branch) return true;
        return vuln.branch === refBranch;
      });

      this.logger.log(
        `Branch filter "reference": filtered ${totalBefore} -> ${allVulnerabilities.length} vulnerabilities`,
      );
    }

    // Apply branch filter if "selected" mode is selected (per-project branch selections)
    if (branchFilter === 'selected' && projectBranchSelections.length > 0) {
      const selectionMap = new Map<string, Set<string>>();
      for (const sel of projectBranchSelections) {
        selectionMap.set(sel.projectId, new Set(sel.branches));
      }

      const totalBefore = allVulnerabilities.length;
      allVulnerabilities = allVulnerabilities.filter((vuln) => {
        const allowedBranches = selectionMap.get(vuln.projectId);
        // If no selection specified for this project, exclude it
        if (!allowedBranches || allowedBranches.size === 0) return false;
        return vuln.branch ? allowedBranches.has(vuln.branch) : true;
      });

      this.logger.log(
        `Branch filter "selected" (${projectBranchSelections.length} projects): filtered ${totalBefore} -> ${allVulnerabilities.length} vulnerabilities`,
      );
    }

    // Build project-branch metadata for grouped display
    const projectBranchesMetadata = this.buildProjectBranchesMetadata(
      allVulnerabilities,
      projectMetaMap,
    );

    // Categorize by report type
    const categories =
      reportType === 'owasp'
        ? this.categorizeByOwasp(allVulnerabilities)
        : this.categorizeByCwe(allVulnerabilities);

    const summary = this.calculateSummary(allVulnerabilities, projectIds);

    return {
      vulnerabilities: allVulnerabilities,
      categories,
      summary,
      projectsMetadata,
      projectBranchesMetadata,
    };
  }

  /**
   * Build metadata for each project-branch combination
   * This enables displaying vulnerabilities grouped by project and branch in reports
   */
  private buildProjectBranchesMetadata(
    vulnerabilities: MappedVulnerability[],
    projectMetaMap: Map<string, any>,
  ): ProjectBranchMetadata[] {
    // Create a map of project-branch combinations with their vulnerability counts
    const projectBranchMap = new Map<string, ProjectBranchMetadata>();

    vulnerabilities.forEach((vuln) => {
      const key = `${vuln.projectId}:${vuln.branch}`;
      const projectMeta = projectMetaMap.get(vuln.projectId);

      if (!projectBranchMap.has(key)) {
        projectBranchMap.set(key, {
          projectId: vuln.projectId,
          projectName: vuln.projectName,
          teamId: projectMeta?.teamId || '',
          teamName: projectMeta?.teamName || 'N/A',
          branch: vuln.branch,
          vulnerabilitiesCount: 0,
        });
      }

      const existing = projectBranchMap.get(key)!;
      existing.vulnerabilitiesCount++;
    });

    // Convert to array and sort by project name, then branch
    return Array.from(projectBranchMap.values()).sort((a, b) => {
      const projectCompare = a.projectName.localeCompare(b.projectName);
      if (projectCompare !== 0) return projectCompare;
      return a.branch.localeCompare(b.branch);
    });
  }

  /**
   * Severity as shown by the dashboard and the per-project reports: the
   * effective (context-adjusted) severity when set, the scanner one otherwise.
   */
  private severityOf(vuln: {
    effectiveSeverity?: string | null;
    currentSeverity?: string | null;
  }): string {
    return String(vuln.effectiveSeverity ?? vuln.currentSeverity ?? '')
      .trim()
      .toLowerCase();
  }

  /** `12` or `12-18`; empty when the scanner reported no line. */
  private lineRange(
    start: number | null | undefined,
    end: number | null | undefined,
  ): string {
    if (!start) return '';
    return end && end !== start ? `${start}-${end}` : `${start}`;
  }

  /**
   * Fixed versions listed by the OSV advisories (range events), per OSV id.
   * Fail-soft: a report without fixed versions beats no report at all.
   */
  private async loadScaFixedVersions(
    osvIds: string[],
  ): Promise<Map<string, ImportedAdvisoryFix[]>> {
    if (!osvIds.length) return new Map();
    try {
      return await loadCatalogueFixes(
        this.scaVulnDetectRepository.manager,
        osvIds,
      );
    } catch (error) {
      this.logger.warn(
        `Aggregated report: SCA fixed versions unavailable (${(error as Error)?.message ?? error})`,
      );
      return new Map();
    }
  }

  /** The catalogue's CVE alias of each advisory. Fail-soft. */
  private async loadCatalogueCves(
    osvIds: string[],
  ): Promise<Map<string, string>> {
    if (!osvIds.length) return new Map();
    try {
      return await loadCatalogueCveAliases(
        this.scaVulnDetectRepository.manager,
        osvIds,
      );
    } catch (error) {
      this.logger.warn(
        `Aggregated report: CVE aliases unavailable (${(error as Error)?.message ?? error})`,
      );
      return new Map();
    }
  }

  /**
   * Map SAST vulnerability to unified format
   */
  private mapSastVulnerability(
    vuln: SastVulnerabilityDetections,
    projectName: string = 'Unknown',
  ): MappedVulnerability {
    return {
      id: vuln.id,
      type: 'sast',
      name: vuln.vulnerability?.name || 'Unknown',
      description: vuln.vulnerability?.description || '',
      severity: this.severityOf(vuln),
      state: vuln.currentState,
      priority: vuln.currentPriority,
      language: vuln.language,
      path: vuln.path,
      line: this.lineRange(vuln.vulnerableStartLine, vuln.vulnerableEndLine),
      cwe: vuln.vulnerability?.cwe || [],
      owaspTop10: vuln.vulnerability?.owaspTop10 || [],
      createdAt: vuln.createdAt,
      updatedAt: vuln.updateAt,
      projectId: vuln.projectId,
      projectName,
      branch: vuln.branch || '',
    };
  }

  /**
   * Map IAC vulnerability to unified format
   */
  private mapIacVulnerability(
    vuln: IacVulnerabilityDetections,
    projectName: string = 'Unknown',
  ): MappedVulnerability {
    return {
      id: vuln.id,
      type: 'iac',
      name: vuln.vulnerability?.name || 'Unknown',
      description: vuln.vulnerability?.description || '',
      severity: this.severityOf(vuln),
      state: vuln.currentState,
      priority: vuln.currentPriority,
      language: vuln.language,
      path: vuln.path,
      line: this.lineRange(vuln.vulnerableStartLine, vuln.vulnerableEndLine),
      cwe: vuln.vulnerability?.cwe || [],
      owaspTop10: vuln.vulnerability?.owaspTop10 || [],
      createdAt: vuln.createdAt,
      updatedAt: vuln.updateAt,
      projectId: vuln.projectId,
      projectName,
      branch: vuln.branch || '',
    };
  }

  /**
   * Map SCA vulnerability to unified format. `fixedVersions` are the fixes
   * listed by the advisory; the report shows the smallest one above the
   * installed version (never a downgrade), like the dashboard.
   */
  private mapScaVulnerability(
    vuln: ScaVulnerabilityDetections,
    projectName: string = 'Unknown',
    fixedVersions: string[] = [],
    catalogueCves: ReadonlyMap<string, string> = new Map(),
  ): MappedVulnerability {
    const installed = vuln.scaDetectedPackage?.packageVersion || '';

    return {
      id: vuln.id,
      type: 'sca',
      name: vuln.vulnerability?.summary || 'Unknown',
      description: vuln.vulnerability?.details || '',
      severity: this.severityOf(vuln),
      state: vuln.currentState,
      priority: vuln.currentPriority,
      packageName: vuln.scaDetectedPackage?.packageName || 'Unknown',
      packageVersion: installed || 'Unknown',
      fixedVersion: getMinFixedAbove(fixedVersions, installed) ?? '',
      cve: cveOfFinding(vuln.vulnerability, catalogueCves),
      advisoryId: vuln.vulnerability?.id || '',
      withdrawn: vuln.vulnerability?.withdrawnAt != null,
      cwe: advisoryCwes(vuln.vulnerability?.databaseSpecific),
      owaspTop10: [],
      createdAt: vuln.createdAt,
      updatedAt: vuln.updatedAt,
      projectId: vuln.projectId,
      projectName,
      branch: vuln.branch || '',
    };
  }

  /**
   * Map Container vulnerability to unified format
   */
  private mapContainerVulnerability(
    vuln: VulnerabilityDetectionsContainer,
    projectName: string = 'Unknown',
    catalogueCves: ReadonlyMap<string, string> = new Map(),
  ): MappedVulnerability {
    return {
      id: vuln.id,
      type: 'container',
      name: vuln.vulnerabilityIdentifier,
      description: vuln.vulnerability?.summary || '',
      severity: this.severityOf(vuln),
      state: vuln.currentState,
      priority: vuln.currentPriority,
      packageName: vuln.detectedPackage?.packageName || 'Unknown',
      packageVersion: vuln.detectedPackage?.packageVersion || '',
      // Installed-aware recommended fix (parity with the dashboard detail/list).
      fixedVersion: installedAwareContainerFix(vuln),
      cvssScore: vuln.cvssScore,
      cve: cveOfFinding(vuln.vulnerability, catalogueCves),
      advisoryId: vuln.vulnerabilityIdentifier || '',
      withdrawn: vuln.vulnerability?.withdrawnAt != null,
      image: vuln.detectedImage?.artifactName || undefined,
      cwe: advisoryCwes(vuln.vulnerability?.databaseSpecific),
      owaspTop10: [],
      createdAt: vuln.createdAt,
      updatedAt: vuln.updatedAt,
      projectId: vuln.projectId,
      projectName,
      branch: vuln.branch || '',
    };
  }

  /**
   * OWASP Top 10 2021 category of a finding, or null outside the Top 10 —
   * the per-project OWASP report's rule, so both reports agree. A vulnerable
   * dependency or container package IS A06 "Vulnerable and Outdated
   * Components". Otherwise the first 2021 category set by the detection rule
   * wins, then the category whose official CWE list holds one of its CWEs.
   */
  private owaspCategoryOf(vuln: MappedVulnerability): string | null {
    if (vuln.type === 'sca' || vuln.type === 'container') return 'A06';
    for (const ref of vuln.owaspTop10 ?? []) {
      const match = /^(A\d{2}):2021/.exec(String(ref).trim());
      if (match && OWASP_TOP_10_2021_DATA[match[1]]) return match[1];
    }
    for (const cweRef of vuln.cwe ?? []) {
      const cwe = String(cweRef).startsWith('CWE-') ? cweRef : `CWE-${cweRef}`;
      const category = Object.values(OWASP_TOP_10_2021_DATA).find((c) =>
        c.mappedCwes.includes(cwe),
      );
      if (category) return category.id;
    }
    return null;
  }

  /**
   * Categorize vulnerabilities by OWASP Top 10 2021: exactly one category per
   * finding (see owaspCategoryOf), so the category counts add up; a finding
   * outside the Top 10 is in no category and stays in the finding list. Every
   * category is returned, empty ones included, in A01…A10 order: the report
   * shows the full matrix.
   */
  private categorizeByOwasp(vulnerabilities: MappedVulnerability[]): any[] {
    const categoriesMap: Record<string, MappedVulnerability[]> = {};
    Object.keys(OWASP_TOP_10_2021_DATA).forEach((owaspId) => {
      categoriesMap[owaspId] = [];
    });
    for (const vuln of vulnerabilities) {
      const id = this.owaspCategoryOf(vuln);
      if (id) categoriesMap[id].push(vuln);
    }
    return Object.keys(OWASP_TOP_10_2021_DATA)
      .sort()
      .map((owaspId) => ({
        categoryData: OWASP_TOP_10_2021_DATA[owaspId],
        vulnerabilities: categoriesMap[owaspId],
        count: categoriesMap[owaspId].length,
      }));
  }

  /**
   * Categorize vulnerabilities by CWE Top 25 2024. Every entry is returned,
   * empty ones included, by rank: the report shows the full list.
   */
  private categorizeByCwe(vulnerabilities: MappedVulnerability[]): any[] {
    const categoriesMap: Record<string, Set<MappedVulnerability>> = {};
    Object.keys(CWE_TOP_25_2024_DATA).forEach((cweId) => {
      categoriesMap[cweId] = new Set();
    });

    vulnerabilities.forEach((vuln) => {
      for (const cweRef of vuln.cwe ?? []) {
        const normalizedCwe = cweRef.startsWith('CWE-')
          ? cweRef
          : `CWE-${cweRef}`;
        categoriesMap[normalizedCwe]?.add(vuln);
      }
    });

    return Object.entries(categoriesMap)
      .map(([cweId, vulnsSet]) => {
        const vulnsArray = Array.from(vulnsSet);
        return {
          cweData: CWE_TOP_25_2024_DATA[cweId],
          vulnerabilities: vulnsArray,
          count: vulnsArray.length,
        };
      })
      .sort((a, b) => a.cweData.rank - b.cweData.rank);
  }

  /**
   * Calculate summary statistics including branch breakdown
   */
  private calculateSummary(
    vulnerabilities: MappedVulnerability[],
    projectIds: string[],
  ): any {
    const byType = {
      sast: vulnerabilities.filter((v) => v.type === 'sast').length,
      iac: vulnerabilities.filter((v) => v.type === 'iac').length,
      sca: vulnerabilities.filter((v) => v.type === 'sca').length,
      container: vulnerabilities.filter((v) => v.type === 'container').length,
    };

    const bySeverity = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    };

    const byState: Record<string, number> = {};
    const byBranch: Record<string, number> = {};

    vulnerabilities.forEach((vuln) => {
      const severity = vuln.severity?.toLowerCase() || 'unknown';
      if (bySeverity.hasOwnProperty(severity)) {
        bySeverity[severity]++;
      } else {
        bySeverity.unknown++;
      }

      const state = vuln.state || 'unknown';
      byState[state] = (byState[state] || 0) + 1;

      // Count by branch
      const branch = vuln.branch || '';
      byBranch[branch] = (byBranch[branch] || 0) + 1;
    });

    // Get unique branches
    const uniqueBranches = [...new Set(vulnerabilities.map((v) => v.branch))];

    return {
      totalVulnerabilities: vulnerabilities.length,
      projectsCount: projectIds.length,
      branchesCount: uniqueBranches.length,
      uniqueBranches,
      byType,
      bySeverity,
      byState,
      byBranch,
    };
  }

  /**
   * Aggregate license data from SCA detected packages across multiple projects.
   *
   * A package (ecosystem + name + version) is counted ONCE, in its effective
   * category (SPDX `OR` keeps the least restrictive side, `AND` or a plain
   * list keeps the most restrictive one), so the categories always add up to
   * the total. It is listed under each license it effectively uses, with the
   * projects that depend on it.
   */
  @Span()
  async aggregateLicenseData(
    projectIds: string[],
    organizationId?: string,
    branchFilter: string = 'all',
    projectBranchSelections: { projectId: string; branches: string[] }[] = [],
  ): Promise<any> {
    this.logger.log(
      `Aggregating license data for ${projectIds.length} projects`,
    );

    // Fetch all SCA detected packages for the given projects
    let packages = await this.scaDetectedPackagesRepository
      .createQueryBuilder('pkg')
      .where('pkg.projectId IN (:...projectIds)', { projectIds })
      .getMany();

    // Get project metadata
    const projectsMetadata = await this.getProjectsMetadata(projectIds);
    const projectMetaMap = new Map(projectsMetadata.map((p) => [p.id, p]));

    // Apply branch filters
    if (branchFilter === 'reference') {
      packages = packages.filter((pkg) => {
        const meta = projectMetaMap.get(pkg.projectId);
        if (!meta?.referenceBranch || !pkg.branch) return true;
        return pkg.branch === meta.referenceBranch;
      });
    } else if (
      branchFilter === 'selected' &&
      projectBranchSelections.length > 0
    ) {
      const selectionMap = new Map<string, Set<string>>();
      for (const sel of projectBranchSelections) {
        selectionMap.set(sel.projectId, new Set(sel.branches));
      }
      packages = packages.filter((pkg) => {
        const allowedBranches = selectionMap.get(pkg.projectId);
        if (!allowedBranches || allowedBranches.size === 0) return false;
        return pkg.branch ? allowedBranches.has(pkg.branch) : true;
      });
    }

    // Load organization-level license overrides
    let overrides: Map<string, LicenseCategory> | undefined;
    if (organizationId) {
      const overrideEntities = await this.scaLicenseOverrideRepository.find({
        where: { organizationId },
      });
      if (overrideEntities.length > 0) {
        overrides = new Map(
          overrideEntities.map((o) => [
            o.spdxId,
            o.category as LicenseCategory,
          ]),
        );
      }
    }

    interface PackageEntry {
      ecosystem: string;
      packageName: string;
      packageVersion: string;
      licenses: string[];
      licenseExpression: string | null;
      category: LicenseCategory;
      effectiveLicenses: string[];
      projects: string[];
      /**
       * The same projects by id: a name is unique only within its team
       * (two teams may each have a « customer-portal »).
       */
      projectIds: string[];
      branches: string[];
      isDev: boolean;
      isTransitive: boolean;
      licenseIgnored: boolean;
    }
    type Entry = PackageEntry & {
      projectSet: Set<string>;
      branchSet: Set<string>;
      projectIdSet: Set<string>;
    };
    const entries = new Map<string, Entry>();
    const projectBranches = new Map<string, Set<string>>();

    for (const pkg of packages) {
      const ecosystem = normalizeEcosystem(pkg.ecosystem);
      const version = normalizePackageVersion(pkg.packageVersion);
      const key = [ecosystem, pkg.packageName, version].join('\u0000');
      const projectName = projectMetaMap.get(pkg.projectId)?.name || 'Unknown';
      let entry = entries.get(key);
      if (!entry) {
        const declared = (pkg.licenses ?? [])
          .map((l) => normalizeLicenseId(l))
          .filter(Boolean);
        const expression = pkg.licenseExpression
          ? normalizeLicenseExpression(pkg.licenseExpression)
          : undefined;
        const category =
          declared.length > 0 || expression
            ? getHighestRiskCategory(declared, overrides, expression)
            : LicenseCategory.UNKNOWN;
        const fromExpression = expression
          ? Array.from(getEffectiveLicenses(expression, overrides))
          : [];
        const effectiveLicenses = fromExpression.length
          ? fromExpression
          : declared.length
            ? Array.from(new Set(declared))
            : ['UNKNOWN'];
        entry = {
          ecosystem,
          packageName: pkg.packageName,
          packageVersion: version,
          licenses: declared,
          licenseExpression: pkg.licenseExpression ?? null,
          category,
          effectiveLicenses,
          projects: [],
          projectIds: [],
          branches: [],
          isDev: true,
          isTransitive: true,
          licenseIgnored: true,
          projectSet: new Set(),
          branchSet: new Set(),
          projectIdSet: new Set(),
        };
        entries.set(key, entry);
      }
      entry.projectSet.add(projectName);
      entry.projectIdSet.add(pkg.projectId);
      if (pkg.branch) entry.branchSet.add(pkg.branch);
      // A package counts as a production / direct dependency as soon as one
      // project uses it that way.
      entry.isDev = entry.isDev && !!pkg.isDev;
      entry.isTransitive = entry.isTransitive && !!pkg.isTransitive;
      entry.licenseIgnored = entry.licenseIgnored && !!pkg.isLicenseIgnored;

      const branches = projectBranches.get(pkg.projectId) ?? new Set();
      if (pkg.branch) branches.add(pkg.branch);
      projectBranches.set(pkg.projectId, branches);
    }
    mergeActionTags(entries);

    // The unit is the package (ecosystem + name): its versions are listed
    // with it. A package is counted in the most restrictive category of its
    // versions, once per project.
    const packageKey = (e: PackageEntry) =>
      `${e.ecosystem}\u0000${e.packageName}`;
    const packageCategory = new Map<string, LicenseCategory>();
    const perProject = new Map<string, Map<string, LicenseCategory>>();
    const keepWorst = (
      map: Map<string, LicenseCategory>,
      key: string,
      category: LicenseCategory,
    ) => {
      const known = map.get(key);
      if (!known || CATEGORY_RANK[category] < CATEGORY_RANK[known]) {
        map.set(key, category);
      }
    };
    for (const entry of entries.values()) {
      keepWorst(packageCategory, packageKey(entry), entry.category);
      for (const projectId of entry.projectIdSet) {
        const inProject = perProject.get(projectId) ?? new Map();
        keepWorst(inProject, packageKey(entry), entry.category);
        perProject.set(projectId, inProject);
      }
    }

    const byName = (a: PackageEntry, b: PackageEntry) =>
      a.packageName.localeCompare(b.packageName) ||
      a.packageVersion.localeCompare(b.packageVersion, undefined, {
        numeric: true,
      });
    const distinct: PackageEntry[] = Array.from(entries.values())
      .map(
        (e): PackageEntry => ({
          ecosystem: e.ecosystem,
          packageName: e.packageName,
          packageVersion: e.packageVersion,
          licenses: e.licenses,
          licenseExpression: e.licenseExpression,
          category: e.category,
          effectiveLicenses: e.effectiveLicenses,
          projects: Array.from(e.projectSet).sort(),
          projectIds: Array.from(e.projectIdSet).sort(),
          branches: Array.from(e.branchSet).sort(),
          isDev: e.isDev,
          isTransitive: e.isTransitive,
          licenseIgnored: e.licenseIgnored,
        }),
      )
      .sort(byName);

    // Per-license lists (a package is listed under each effective license).
    const categoryMap: Record<
      string,
      {
        spdxId: string;
        name: string;
        category: string;
        risk: string;
        packages: PackageEntry[];
      }
    > = {};
    for (const entry of distinct) {
      for (const spdxId of entry.effectiveLicenses) {
        const info = getLicenseInfo(spdxId, overrides);
        if (!categoryMap[info.spdxId]) {
          categoryMap[info.spdxId] = {
            spdxId: info.spdxId,
            name: info.name,
            category: info.category,
            risk: info.risk,
            packages: [],
          };
        }
        categoryMap[info.spdxId].packages.push(entry);
      }
    }

    const licenseCategories = {
      [LicenseCategory.PERMISSIVE]: [] as any[],
      [LicenseCategory.WEAK_COPYLEFT]: [] as any[],
      [LicenseCategory.STRONG_COPYLEFT]: [] as any[],
      [LicenseCategory.UNKNOWN]: [] as any[],
    };
    for (const license of Object.values(categoryMap)) {
      licenseCategories[license.category].push(license);
    }
    for (const cat of Object.values(licenseCategories)) {
      cat.sort(
        (a, b) =>
          b.packages.length - a.packages.length ||
          a.spdxId.localeCompare(b.spdxId),
      );
    }

    const countByCategory = (categories: Iterable<LicenseCategory>) => {
      const counts = {
        permissive: 0,
        weakCopyleft: 0,
        strongCopyleft: 0,
        unknown: 0,
      };
      for (const category of categories) {
        if (category === LicenseCategory.PERMISSIVE) counts.permissive++;
        else if (category === LicenseCategory.WEAK_COPYLEFT)
          counts.weakCopyleft++;
        else if (category === LicenseCategory.STRONG_COPYLEFT)
          counts.strongCopyleft++;
        else counts.unknown++;
      }
      return counts;
    };

    const projectRows = projectIds
      .map((projectId) => {
        const meta = projectMetaMap.get(projectId);
        const inProject = perProject.get(projectId) ?? new Map();
        return {
          projectId,
          projectName: meta?.name || 'Unknown',
          teamName: meta?.teamName || '',
          branches: Array.from(projectBranches.get(projectId) ?? []).sort(),
          packages: inProject.size,
          byCategory: countByCategory(inProject.values()),
        };
      })
      .sort((a, b) => a.projectName.localeCompare(b.projectName));

    const summary = {
      totalPackages: packageCategory.size,
      totalVersions: distinct.length,
      packageOccurrences: packages.length,
      uniqueLicenses: Object.keys(categoryMap).filter((id) => id !== 'UNKNOWN')
        .length,
      projectsCount: projectIds.length,
      projectsWithPackages: projectRows.filter((r) => r.packages > 0).length,
      byCategory: countByCategory(packageCategory.values()),
    };

    return {
      summary,
      licenseCategories,
      packages: distinct,
      projectRows,
      projectsMetadata,
    };
  }
}
