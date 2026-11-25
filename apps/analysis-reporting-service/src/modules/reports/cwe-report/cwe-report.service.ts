import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Span } from 'nestjs-otel';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { PdfGeneratorService } from 'src/core/utils/pdf-generator.service';
import { ProjectNameResolver } from '../shared/project-name-resolver.service';
import {
  REPORT_ANALYSIS,
  type ReportAnalysisFamily,
  type ReportAnalysisPort,
} from '../../../edition/ports/report-analysis.port';
import {
  advisoryCwes,
  isActiveState,
  normalizeCweId,
} from '../shared/report-findings';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { installedAwareContainerFix } from '../../container/container.mapper';
import { getMinFixedAbove } from '../../sca/sca.utils';
import { VulnerabilityOsv } from 'src/entities/osv/vulnerability-osv.entity';
import {
  applyImportedAdvisories,
  catalogueAdvisoryIds,
  cveOfFinding,
  fixesOfFinding,
  loadCatalogueCveAliases,
  loadCatalogueFixes,
} from '../../results-import/imported-advisory.view';

/** The package of an SCA finding, as the advisory reads compare it. */
const scaPackageOf = (d: ScaVulnerabilityDetections) =>
  d.scaDetectedPackage
    ? {
        packageName: d.scaDetectedPackage.packageName,
        ecosystem: d.scaDetectedPackage.ecosystem,
      }
    : null;

/** The package of a container finding (its ecosystem is not recorded). */
const containerPackageOf = (d: VulnerabilityDetectionsContainer) =>
  d.detectedPackage
    ? { packageName: d.detectedPackage.packageName, ecosystem: '' }
    : null;
import { CWE_TOP_25_2024_DATA } from './constants/cwe-data.constants';
import { CweReport } from 'src/entities/cwe-report.entity';
import {
  CweCategoryWithVulnerabilities,
  CweReportData,
  MappedExploitability,
  MappedVulnerability,
  ScanMetadata,
  SeverityCounts,
  Top25Summary,
} from './cwe-report.types';
import { cweReportTitle, renderCweReport } from './cwe-report.template';

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
const STATE_ORDER: Record<string, number> = {
  confirmed: 0,
  to_verify: 1,
  proposed_not_exploitable: 2,
};

const normalizeCweList = (refs: unknown): string[] =>
  Array.isArray(refs)
    ? Array.from(new Set(refs.map(normalizeCweId).filter(Boolean)))
    : [];

const severityRank = (severity: string): number =>
  SEVERITY_ORDER[String(severity ?? '').toLowerCase()] ?? 4;
const stateRank = (state: string): number =>
  STATE_ORDER[String(state ?? '').toLowerCase()] ?? 3;
const startLine = (line?: string): number =>
  Number.parseInt(String(line ?? '').split('-')[0], 10) || 0;
const locationOf = (v: MappedVulnerability): string =>
  v.path ?? `${v.packageName ?? ''}@${v.packageVersion ?? ''}`;

/** Open findings first, then severity, state, location and line. */
function compareFindings(a: MappedVulnerability, b: MappedVulnerability) {
  return (
    Number(!isActiveState(a.state)) - Number(!isActiveState(b.state)) ||
    severityRank(a.severity) - severityRank(b.severity) ||
    stateRank(a.state) - stateRank(b.state) ||
    locationOf(a).localeCompare(locationOf(b)) ||
    startLine(a.line) - startLine(b.line)
  );
}

function exploitabilityOf(row: {
  exploitabilityVerdict?: string | null;
  exploitabilitySource?: string | null;
  exploitabilityScore?: number | null;
  exploitabilityReason?: string | null;
}): MappedExploitability | undefined {
  if (!row?.exploitabilityVerdict) return undefined;
  return {
    verdict: row.exploitabilityVerdict,
    source: row.exploitabilitySource ?? 'static',
    score:
      typeof row.exploitabilityScore === 'number'
        ? row.exploitabilityScore
        : null,
    reason: row.exploitabilityReason || null,
  };
}

function countBySeverity(items: MappedVulnerability[]): SeverityCounts {
  const counts: SeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  };
  for (const item of items) {
    const severity = String(item.severity ?? '').toLowerCase();
    if (severity in counts && severity !== 'unknown') counts[severity]++;
    else counts.unknown++;
  }
  return counts;
}

/**
 * Summary of the Top 25 scope: OPEN findings attached to at least one
 * category, each counted once even when it belongs to several categories.
 */
export function summarizeTop25(
  categories: CweCategoryWithVulnerabilities[],
): Top25Summary {
  const open = new Map<string, MappedVulnerability>();
  const triaged = new Set<string>();
  for (const category of categories) {
    for (const v of category.vulnerabilities) {
      if (isActiveState(v.state)) open.set(v.id, v);
      else triaged.add(v.id);
    }
  }
  const findings = Array.from(open.values());
  const byType = { sast: 0, iac: 0, sca: 0, container: 0 };
  for (const v of findings) byType[v.type] = (byType[v.type] ?? 0) + 1;
  return {
    findings: findings.length,
    categoriesAffected: categories.filter((c) => c.count > 0).length,
    bySeverity: countBySeverity(findings),
    byType,
    triaged: triaged.size,
  };
}

@Injectable()
export class CweReportService {
  constructor(
    @InjectRepository(CweReport)
    private readonly cweReportRepository: Repository<CweReport>,
    @InjectRepository(ScaVulnerabilityDetections)
    private readonly scaVulnDetectRepository: Repository<ScaVulnerabilityDetections>,
    @InjectRepository(SastVulnerabilityDetections)
    private readonly sastVulnDetectRepository: Repository<SastVulnerabilityDetections>,
    @InjectRepository(IacVulnerabilityDetections)
    private readonly iacVulnDetectRepository: Repository<IacVulnerabilityDetections>,
    @InjectRepository(VulnerabilityDetectionsContainer)
    private readonly containerVulnDetectRepository: Repository<VulnerabilityDetectionsContainer>,
    private readonly logger: Logger,
    private readonly pdfGeneratorService: PdfGeneratorService,
    private readonly projectNameResolver: ProjectNameResolver,
    // The analyses of the findings and how to print them, registered by an
    // ee module; absent in the Community Edition.
    @Optional()
    @Inject(REPORT_ANALYSIS)
    private readonly reportAnalysis?: ReportAnalysisPort,
  ) {}

  @Span()
  async generateReport(
    projectId: string,
    format: string,
    detailed: boolean = true,
    branch?: string,
  ): Promise<{ content: Buffer; filename: string; contentType: string }> {
    this.logger.log(
      `Generating CWE Top 25 report in ${format} format for project ${projectId} (detailed: ${detailed}, branch: ${branch ?? 'all'})`,
    );

    const reportData = await this.generateCweData(projectId, branch, detailed);

    // Store report in database
    await this.storeReport(projectId, reportData, format);

    return this.formatReport(reportData, format, detailed, branch);
  }

  @Span()
  private async storeReport(
    projectId: string,
    reportData: CweReportData,
    format: string,
  ): Promise<CweReport> {
    try {
      const reportJson = JSON.stringify(reportData);

      const existingReport = await this.cweReportRepository.findOne({
        where: { projectId },
        order: { createdAt: 'DESC' },
      });

      if (existingReport) {
        existingReport.reportJson = reportJson;
        existingReport.format = format;
        return await this.cweReportRepository.save(existingReport);
      } else {
        const newReport = this.cweReportRepository.create({
          projectId,
          reportJson,
          format,
        });
        return await this.cweReportRepository.save(newReport);
      }
    } catch (error) {
      this.logger.error(
        `Error storing CWE report: ${error.message}`,
        error.stack,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to store CWE report',
      });
    }
  }

  @Span()
  private async generateCweData(
    projectId: string,
    branch?: string,
    detailed: boolean = false,
  ): Promise<CweReportData> {
    // Backward-compat: branch undefined/empty = no filter (all branches).
    const branchWhere = branch ? { branch } : {};
    const [sastVulns, iacVulns, scaVulns, containerVulns] = await Promise.all([
      this.sastVulnDetectRepository.find({
        where: { projectId, ...branchWhere },
        relations: ['vulnerability'],
      }),
      this.iacVulnDetectRepository.find({
        where: { projectId, ...branchWhere },
        relations: ['vulnerability'],
      }),
      this.scaVulnDetectRepository.find({
        where: { projectId, ...branchWhere },
        relations: ['scaDetectedPackage', 'vulnerability'],
      }),
      this.containerVulnDetectRepository.find({
        where: { projectId, ...branchWhere },
        relations: ['detectedPackage', 'detectedImage', 'vulnerability'],
      }),
    ]);

    // An advisory the project imported is read from the project's own row;
    // the catalogue's CVE aliases are read once for the others.
    const manager = this.scaVulnDetectRepository.manager;
    await applyImportedAdvisories(manager, scaVulns, scaPackageOf);
    await applyImportedAdvisories(manager, containerVulns, containerPackageOf);
    const catalogueCves = await this.loadCatalogueCves([
      ...scaVulns.map((v) => v.vulnerability),
      ...containerVulns.map((v) => v.vulnerability),
    ]);
    const scaMapped = scaVulns.map((v) =>
      this.mapScaVulnerability(v, catalogueCves),
    );
    await this.applyScaFixedVersions(scaVulns, scaMapped);

    const sast = sastVulns.map((v) => this.mapSastVulnerability(v));
    const iac = iacVulns.map((v) => this.mapIacVulnerability(v));
    const container = containerVulns.map((v) =>
      this.mapContainerVulnerability(v, catalogueCves),
    );
    // Cybe Analysis (detailed report): set once on the object, which the
    // list and the categories share by reference.
    if (detailed)
      await Promise.all([
        this.attachCybeAnalyses(projectId, 'sast', sast),
        this.attachCybeAnalyses(projectId, 'iac', iac),
        this.attachCybeAnalyses(projectId, 'sca', scaMapped),
        this.attachCybeAnalyses(projectId, 'container', container),
      ]);
    const allVulnerabilities: MappedVulnerability[] = [
      ...sast,
      ...iac,
      ...scaMapped,
      ...container,
    ];

    const cweCategoriesWithVulns =
      this.mapVulnerabilitiesToCweCategories(allVulnerabilities);

    const summary: CweReportData['summary'] = {
      totalVulnerabilities: allVulnerabilities.length,
      openFindings: allVulnerabilities.filter((v) => isActiveState(v.state))
        .length,
      byType: {
        sast: sastVulns.length,
        iac: iacVulns.length,
        sca: scaVulns.length,
        container: containerVulns.length,
      },
      bySeverity: countBySeverity(allVulnerabilities),
      byState: this.countByState(allVulnerabilities),
      byCweCategory: Object.fromEntries(
        cweCategoriesWithVulns.map((c) => [c.cweData.id, c.count]),
      ),
      top25: summarizeTop25(cweCategoriesWithVulns),
    };

    const scanMetadata: ScanMetadata = {
      projectId,
      // Readable name resolved fail-soft; undefined when the lookup fails.
      projectName: await this.projectNameResolver.resolve(projectId),
      // Scanned branch: raw value (undefined/empty = all branches); the
      // "All branches" wording is applied at render time.
      branch: branch || undefined,
    };

    return {
      projectId,
      generatedAt: new Date().toISOString(),
      scanMetadata,
      summary,
      cweCategories: cweCategoriesWithVulns,
      vulnerabilities: allVulnerabilities,
    };
  }

  private mapSastVulnerability(
    vuln: SastVulnerabilityDetections,
  ): MappedVulnerability {
    return {
      id: vuln.id,
      type: 'sast',
      name: vuln.vulnerability?.name || 'Unknown',
      description: vuln.vulnerability?.description || '',
      severity: vuln.effectiveSeverity ?? vuln.currentSeverity,
      state: vuln.currentState,
      priority: vuln.currentPriority,
      language: vuln.language,
      path: vuln.path,
      line: `${vuln.vulnerableStartLine}-${vuln.vulnerableEndLine}`,
      cwe: normalizeCweList(vuln.vulnerability?.cwe),
      exploitability: exploitabilityOf(vuln),
      createdAt: vuln.createdAt,
      updatedAt: vuln.updateAt,
    };
  }

  private mapIacVulnerability(
    vuln: IacVulnerabilityDetections,
  ): MappedVulnerability {
    return {
      id: vuln.id,
      type: 'iac',
      name: vuln.vulnerability?.name || 'Unknown',
      description: vuln.vulnerability?.description || '',
      severity: vuln.effectiveSeverity ?? vuln.currentSeverity,
      state: vuln.currentState,
      priority: vuln.currentPriority,
      language: vuln.language,
      path: vuln.path,
      line: `${vuln.vulnerableStartLine}-${vuln.vulnerableEndLine}`,
      cwe: normalizeCweList(vuln.vulnerability?.cwe),
      exploitability: exploitabilityOf(vuln),
      createdAt: vuln.createdAt,
      updatedAt: vuln.updateAt,
    };
  }

  private mapScaVulnerability(
    vuln: ScaVulnerabilityDetections,
    catalogueCves: ReadonlyMap<string, string> = new Map(),
  ): MappedVulnerability {
    return {
      id: vuln.id,
      type: 'sca',
      name: vuln.vulnerability?.summary || 'Unknown',
      description: vuln.vulnerability?.details || '',
      severity: vuln.effectiveSeverity ?? vuln.currentSeverity,
      state: vuln.currentState,
      priority: vuln.currentPriority,
      packageName: vuln.scaDetectedPackage?.packageName || 'Unknown',
      packageVersion: vuln.scaDetectedPackage?.packageVersion || 'Unknown',
      manifest: vuln.scaDetectedPackage?.fileName || undefined,
      advisoryId: vuln.vulnerability?.id,
      ...(vuln.vulnerability?.withdrawnAt ? { withdrawn: true } : {}),
      ...(vuln.scaDetectedPackage?.isDev ? { devDependency: true } : {}),
      cve: cveOfFinding(vuln.vulnerability, catalogueCves),
      cwe: advisoryCwes(vuln.vulnerability?.databaseSpecific),
      exploitability: exploitabilityOf(vuln),
      createdAt: vuln.createdAt,
      updatedAt: vuln.updatedAt,
    };
  }

  private mapContainerVulnerability(
    vuln: VulnerabilityDetectionsContainer,
    catalogueCves: ReadonlyMap<string, string> = new Map(),
  ): MappedVulnerability {
    return {
      id: vuln.id,
      type: 'container',
      name: vuln.vulnerabilityIdentifier,
      description: vuln.vulnerability?.summary || '',
      severity: vuln.effectiveSeverity ?? vuln.currentSeverity,
      state: vuln.currentState,
      priority: vuln.currentPriority,
      packageName: vuln.detectedPackage?.packageName || 'Unknown',
      packageVersion: vuln.detectedPackage?.packageVersion || undefined,
      image: vuln.detectedImage?.artifactName || undefined,
      advisoryId: vuln.vulnerability?.id ?? vuln.vulnerabilityIdentifier,
      ...(vuln.vulnerability?.withdrawnAt ? { withdrawn: true } : {}),
      // Installed-aware recommended fix (parity with the dashboard detail/list).
      fixedVersion: installedAwareContainerFix(vuln),
      cvssScore: vuln.cvssScore,
      cve: cveOfFinding(vuln.vulnerability, catalogueCves),
      cwe: advisoryCwes(vuln.vulnerability?.databaseSpecific),
      exploitability: exploitabilityOf(vuln),
      createdAt: vuln.createdAt,
      updatedAt: vuln.updatedAt,
    };
  }

  /**
   * Pins on each finding the analysis the bound extension has for it: open
   * findings of every severity, plus the critical and high triaged ones.
   * Fail-soft: without analyses, the report keeps the agent's short notes.
   * Nothing without an analysis extension.
   */
  private async attachCybeAnalyses(
    projectId: string,
    family: ReportAnalysisFamily,
    vulns: MappedVulnerability[],
  ): Promise<void> {
    if (!this.reportAnalysis) return;
    const ids = vulns
      .filter((v) => {
        // Raw database value ('HIGH', 'MEDIUM'…).
        const severity = String(v.severity ?? '').toLowerCase();
        return (
          isActiveState(v.state) ||
          severity === 'critical' ||
          severity === 'high'
        );
      })
      .map((v) => v.id);
    try {
      const analyses = await this.reportAnalysis.load(projectId, family, ids);
      for (const v of vulns) {
        const analysis = analyses.get(v.id);
        if (analysis) v.cybeAnalysis = analysis;
      }
    } catch (err) {
      this.logger.warn(
        `Cybe Analysis lookup failed (project=${projectId}, family=${family}): ${(err as Error).message}`,
      );
    }
  }

  /** The catalogue's CVE alias of each catalogue advisory. Fail-soft. */
  private async loadCatalogueCves(
    advisories: Array<VulnerabilityOsv | null | undefined>,
  ): Promise<Map<string, string>> {
    const ids = catalogueAdvisoryIds(advisories);
    if (!ids.length) return new Map();
    try {
      return await loadCatalogueCveAliases(
        this.scaVulnDetectRepository.manager,
        ids,
      );
    } catch (error) {
      this.logger.warn(
        `CWE report: CVE aliases unavailable (${(error as Error).message})`,
      );
      return new Map();
    }
  }

  /**
   * Installed-aware fixed version of the SCA findings shown in the report
   * (those mapped to the Top 25), of each finding's own package: its
   * imported advisory's, else the catalogue's (one batched read, the
   * dashboard list's rule). Fail-soft: the report never depends on it.
   */
  private async applyScaFixedVersions(
    detections: ScaVulnerabilityDetections[],
    findings: MappedVulnerability[],
  ): Promise<void> {
    const shownIds = new Set(
      findings
        .filter(
          (f) => f.advisoryId && f.cwe.some((id) => CWE_TOP_25_2024_DATA[id]),
        )
        .map((f) => f.id),
    );
    const shown = detections.filter((d) => shownIds.has(d.id));
    if (!shown.length) return;
    try {
      const catalogueFixes = await loadCatalogueFixes(
        this.scaVulnDetectRepository.manager,
        catalogueAdvisoryIds(shown.map((d) => d.vulnerability)),
      );
      const byId = new Map(findings.map((f) => [f.id, f]));
      for (const detection of shown) {
        const fixed = getMinFixedAbove(
          fixesOfFinding(
            detection.vulnerability,
            scaPackageOf(detection),
            catalogueFixes,
          ),
          detection.scaDetectedPackage?.packageVersion ?? '',
        );
        const finding = byId.get(detection.id);
        if (fixed && finding) finding.fixedVersion = fixed;
      }
    } catch (error) {
      this.logger.warn(
        `CWE report: fixed versions unavailable (${(error as Error).message})`,
      );
    }
  }

  /**
   * Attaches each finding to the Top 25 categories of its CWEs. A finding
   * belonging to two categories appears in each; `count` counts only open
   * findings (triaged findings stay listed, for the closing section of the
   * report).
   */
  private mapVulnerabilitiesToCweCategories(
    vulnerabilities: MappedVulnerability[],
  ): CweCategoryWithVulnerabilities[] {
    const byCategory = new Map<string, MappedVulnerability[]>();
    for (const vuln of vulnerabilities) {
      for (const cweId of vuln.cwe ?? []) {
        if (!CWE_TOP_25_2024_DATA[cweId]) continue;
        byCategory.set(cweId, [...(byCategory.get(cweId) ?? []), vuln]);
      }
    }
    return Array.from(byCategory, ([cweId, list]) => ({
      cweData: CWE_TOP_25_2024_DATA[cweId],
      vulnerabilities: [...list].sort(compareFindings),
      count: list.filter((v) => isActiveState(v.state)).length,
    })).sort((a, b) => a.cweData.rank - b.cweData.rank);
  }

  private countByState(items: MappedVulnerability[]): Record<string, number> {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      const state = item.state || 'unknown';
      counts[state] = (counts[state] || 0) + 1;
    });
    return counts;
  }

  // Frozen signature: a local rendering harness calls it.
  private async formatReport(
    reportData: CweReportData,
    format: string,
    detailed: boolean = true,
    branch?: string,
  ): Promise<{ content: Buffer; filename: string; contentType: string }> {
    const timestamp = new Date().toISOString().split('T')[0];
    const branchSegment = branch ? `-${sanitizeBranchForFilename(branch)}` : '';
    const baseFilename = `cwe-top25-report-${reportData.projectId}${branchSegment}-${timestamp}`;

    if (format === 'json') {
      return {
        content: Buffer.from(JSON.stringify(reportData, null, 2)),
        filename: `${baseFilename}.json`,
        contentType: 'application/json',
      };
    } else if (format === 'html') {
      const html = renderCweReport(reportData, {
        detailed,
        forPdf: false,
        analysis: this.reportAnalysis?.renderer,
      });
      return {
        content: Buffer.from(html),
        filename: `${baseFilename}.html`,
        contentType: 'text/html',
      };
    } else if (format === 'pdf') {
      const html = renderCweReport(reportData, {
        detailed,
        forPdf: true,
        analysis: this.reportAnalysis?.renderer,
      });
      const pdfBuffer = await this.pdfGeneratorService.generatePDF(html, {
        waitForSelector: '.footer',
        timeout: 30000,
        footerTitle: cweReportTitle(reportData.scanMetadata),
      });
      return {
        content: pdfBuffer,
        filename: `${baseFilename}.pdf`,
        contentType: 'application/pdf',
      };
    } else {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `Invalid format`,
      });
    }
  }
}

/**
 * Normalize a branch name for use in a filename:
 * keep [A-Za-z0-9._-], replace anything else with `_`, cap length to 64.
 */
function sanitizeBranchForFilename(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64);
}
