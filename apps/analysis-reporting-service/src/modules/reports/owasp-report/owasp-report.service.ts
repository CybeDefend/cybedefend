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
import { isActiveState } from '../shared/report-findings';
import { OwaspReport } from 'src/entities/owasp-report.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { installedAwareContainerFix } from '../../container/container.mapper';
import { getMinFixedAbove } from '../../sca/sca.utils';
import { OWASP_TOP_10_2021_DATA } from './constants/owasp-data.constants';
import { owaspReportTitle, renderOwaspReport } from './owasp-report.template';
import {
  MappedVulnerability,
  OwaspCategoryWithVulnerabilities,
  OwaspExploitability,
  OwaspReportData,
  ScanMetadata,
} from './owasp-report.types';

/** Detection columns shared by every family that carry the exploitability assessment. */
interface ExploitabilityColumns {
  exploitabilityVerdict?: string | null;
  exploitabilitySource?: string | null;
  exploitabilityScore?: number | null;
  exploitabilityReason?: string | null;
}

@Injectable()
export class OwaspReportService {
  constructor(
    @InjectRepository(OwaspReport)
    private readonly owaspReportRepository: Repository<OwaspReport>,
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
      `Generating OWASP Top 10 report in ${format} format for project ${projectId} (detailed: ${detailed}, branch: ${branch ?? 'all'})`,
    );

    const reportData = await this.generateOwaspData(
      projectId,
      branch,
      detailed,
    );

    // Store report in database
    await this.storeReport(projectId, reportData, format);

    return this.formatReport(reportData, format, detailed, branch);
  }

  @Span()
  private async storeReport(
    projectId: string,
    reportData: OwaspReportData,
    format: string,
  ): Promise<OwaspReport> {
    try {
      const reportJson = JSON.stringify(reportData);

      const existingReport = await this.owaspReportRepository.findOne({
        where: { projectId },
        order: { createdAt: 'DESC' },
      });

      if (existingReport) {
        existingReport.reportJson = reportJson;
        existingReport.format = format;
        return await this.owaspReportRepository.save(existingReport);
      } else {
        const newReport = this.owaspReportRepository.create({
          projectId,
          reportJson,
          format,
        });
        return await this.owaspReportRepository.save(newReport);
      }
    } catch (error) {
      this.logger.error(
        `Error storing OWASP report: ${error.message}`,
        error.stack,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to store OWASP report',
      });
    }
  }

  @Span()
  private async generateOwaspData(
    projectId: string,
    branch?: string,
    detailed: boolean = false,
  ): Promise<OwaspReportData> {
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
        relations: [
          'scaDetectedPackage',
          'vulnerability',
          'vulnerability.aliases',
          'vulnerability.affected',
          'vulnerability.affected.ranges',
          'vulnerability.affected.ranges.events',
        ],
        // One query per relation: joining aliases × affected × ranges ×
        // events in a single statement multiplies the rows per detection.
        relationLoadStrategy: 'query',
      }),
      this.containerVulnDetectRepository.find({
        where: { projectId, ...branchWhere },
        relations: ['detectedPackage', 'detectedImage', 'vulnerability'],
      }),
    ]);

    // Map all vulnerabilities to unified format
    const sast = sastVulns.map((v) => this.mapSastVulnerability(v));
    const iac = iacVulns.map((v) => this.mapIacVulnerability(v));
    const sca = scaVulns.map((v) => this.mapScaVulnerability(v));
    const container = containerVulns.map((v) =>
      this.mapContainerVulnerability(v),
    );
    // Cybe Analysis (detailed report): set once on the object, which the
    // list and the categories share by reference.
    if (detailed)
      await Promise.all([
        this.attachCybeAnalyses(projectId, 'sast', sast),
        this.attachCybeAnalyses(projectId, 'iac', iac),
        this.attachCybeAnalyses(projectId, 'sca', sca),
        this.attachCybeAnalyses(projectId, 'container', container),
      ]);
    const allVulnerabilities: MappedVulnerability[] = [
      ...sast,
      ...iac,
      ...sca,
      ...container,
    ];

    const owaspCategoriesWithVulns =
      this.mapVulnerabilitiesToOwaspCategories(allVulnerabilities);
    const mappedCount = owaspCategoriesWithVulns.reduce(
      (sum, category) => sum + category.count,
      0,
    );

    const summary = {
      totalVulnerabilities: allVulnerabilities.length,
      byType: {
        sast: sastVulns.length,
        iac: iacVulns.length,
        sca: scaVulns.length,
        container: containerVulns.length,
      },
      bySeverity: this.countBySeverity(allVulnerabilities),
      byState: this.countByState(allVulnerabilities),
      byOwaspCategory: this.countByOwaspCategory(owaspCategoriesWithVulns),
      unmapped: allVulnerabilities.length - mappedCount,
    };

    const scanMetadata: ScanMetadata = {
      projectId,
      // Readable name resolved fail-soft; undefined when the lookup fails.
      projectName: await this.projectNameResolver.resolve(projectId),
      // Scanned branch: raw value (undefined/empty = all branches); the
      // "All branches" wording is applied at render time.
      branch: branch || undefined,
      scanDate: new Date().toISOString(),
      scanDuration: 'N/A',
      profileUsed: 'OWASP Top 10 2021',
    };

    return {
      projectId,
      generatedAt: new Date().toISOString(),
      scanMetadata,
      summary,
      owaspCategories: owaspCategoriesWithVulns,
      vulnerabilities: allVulnerabilities,
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

  private mapExploitability(
    row: ExploitabilityColumns,
  ): OwaspExploitability | undefined {
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
      cwe: vuln.vulnerability?.cwe || [],
      owaspTop10: vuln.vulnerability?.owaspTop10 || [],
      exploitability: this.mapExploitability(vuln),
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
      cwe: vuln.vulnerability?.cwe || [],
      owaspTop10: vuln.vulnerability?.owaspTop10 || [],
      exploitability: this.mapExploitability(vuln),
      createdAt: vuln.createdAt,
      updatedAt: vuln.updateAt,
    };
  }

  private mapScaVulnerability(
    vuln: ScaVulnerabilityDetections,
  ): MappedVulnerability {
    const osv = vuln.vulnerability;
    const cveAlias = osv?.aliases?.find((a) => a.alias.startsWith('CVE-'));
    const packageName = vuln.scaDetectedPackage?.packageName;
    const packageVersion = vuln.scaDetectedPackage?.packageVersion;

    // Recommended fix: the smallest `fixed` event strictly above the
    // installed version (never a downgrade), as on the dashboard.
    const affected = osv?.affected ?? [];
    const forPackage = affected.filter((a) => a.packageName === packageName);
    const fixes = (forPackage.length ? forPackage : affected)
      .flatMap((a) => a.ranges ?? [])
      .flatMap((r) => r.events ?? [])
      .map((e) => e.fixed)
      .filter(Boolean);
    const fixedVersion = packageVersion
      ? getMinFixedAbove(fixes, packageVersion)
      : null;

    return {
      id: vuln.id,
      type: 'sca',
      name: osv?.summary || 'Unknown',
      description: osv?.details || '',
      severity: vuln.effectiveSeverity ?? vuln.currentSeverity,
      state: vuln.currentState,
      priority: vuln.currentPriority,
      packageName: packageName || 'Unknown',
      packageVersion: packageVersion || 'Unknown',
      fixedVersion: fixedVersion || undefined,
      advisoryId: osv?.id,
      withdrawn: osv?.withdrawnAt != null,
      cve: cveAlias?.alias || '',
      cwe: [],
      owaspTop10: [],
      exploitability: this.mapExploitability(vuln),
      createdAt: vuln.createdAt,
      updatedAt: vuln.updatedAt,
    };
  }

  private mapContainerVulnerability(
    vuln: VulnerabilityDetectionsContainer,
  ): MappedVulnerability {
    const cveAlias = vuln.vulnerability?.aliases?.find((a) =>
      a.alias.startsWith('CVE-'),
    );

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
      // Installed-aware recommended fix (parity with the dashboard detail/list).
      fixedVersion: installedAwareContainerFix(vuln),
      imageName: vuln.detectedImage?.artifactName || undefined,
      cvssScore: vuln.cvssScore,
      withdrawn: vuln.vulnerability?.withdrawnAt != null,
      cve: cveAlias?.alias || '',
      cwe: [],
      owaspTop10: [],
      exploitability: this.mapExploitability(vuln),
      createdAt: vuln.createdAt,
      updatedAt: vuln.updatedAt,
    };
  }

  /**
   * OWASP Top 10 2021 category of a finding, or null outside the Top 10.
   * A vulnerable dependency or container package IS A06 "Vulnerable and
   * Outdated Components" by definition. Otherwise the 2021 category set by
   * the detection rule wins, then the category whose official CWE list holds
   * one of the finding's CWEs. Exactly one category per finding, so the
   * category counts add up to the total.
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

  /** Groups findings by OWASP category (A01 → A10), empty categories left out. */
  private mapVulnerabilitiesToOwaspCategories(
    vulnerabilities: MappedVulnerability[],
  ): OwaspCategoryWithVulnerabilities[] {
    const byCategory = new Map<string, MappedVulnerability[]>();
    for (const vuln of vulnerabilities) {
      const id = this.owaspCategoryOf(vuln);
      if (!id) continue;
      byCategory.set(id, [...(byCategory.get(id) ?? []), vuln]);
    }
    return Object.keys(OWASP_TOP_10_2021_DATA)
      .filter((id) => byCategory.has(id))
      .map((id) => ({
        categoryData: OWASP_TOP_10_2021_DATA[id],
        vulnerabilities: byCategory.get(id),
        count: byCategory.get(id).length,
      }));
  }

  private countBySeverity(items: MappedVulnerability[]): {
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
  } {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
    items.forEach((item) => {
      const severity = item.severity?.toLowerCase() || 'unknown';
      if (counts.hasOwnProperty(severity)) {
        counts[severity]++;
      } else {
        counts.unknown++;
      }
    });
    return counts;
  }

  private countByState(items: MappedVulnerability[]): Record<string, number> {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      const state = item.state || 'unknown';
      counts[state] = (counts[state] || 0) + 1;
    });
    return counts;
  }

  private countByOwaspCategory(
    owaspCategories: OwaspCategoryWithVulnerabilities[],
  ): Record<string, number> {
    const counts: Record<string, number> = {};
    owaspCategories.forEach((category) => {
      counts[category.categoryData.code] = category.count;
    });
    return counts;
  }

  private async formatReport(
    reportData: OwaspReportData,
    format: string,
    detailed: boolean = true,
    branch?: string,
  ): Promise<{ content: Buffer; filename: string; contentType: string }> {
    const timestamp = new Date().toISOString().split('T')[0];
    const branchSegment = branch ? `-${sanitizeBranchForFilename(branch)}` : '';
    const baseFilename = `owasp-top10-report-${reportData.projectId}${branchSegment}-${timestamp}`;

    if (format === 'json') {
      return {
        content: Buffer.from(JSON.stringify(reportData, null, 2)),
        filename: `${baseFilename}.json`,
        contentType: 'application/json',
      };
    } else if (format === 'html') {
      const html = renderOwaspReport(reportData, {
        forPdf: false,
        detailed,
        analysis: this.reportAnalysis?.renderer,
      });
      return {
        content: Buffer.from(html),
        filename: `${baseFilename}.html`,
        contentType: 'text/html',
      };
    } else if (format === 'pdf') {
      const html = renderOwaspReport(reportData, {
        forPdf: true,
        detailed,
        analysis: this.reportAnalysis?.renderer,
      });
      const pdfBuffer = await this.pdfGeneratorService.generatePDF(html, {
        waitForSelector: '.footer',
        timeout: 30000,
        footerTitle: owaspReportTitle(reportData),
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
 * Avoids issues with `/`, spaces, and other characters in refs like
 * `feature/foo-bar` becoming part of an HTTP Content-Disposition filename.
 */
function sanitizeBranchForFilename(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64);
}
