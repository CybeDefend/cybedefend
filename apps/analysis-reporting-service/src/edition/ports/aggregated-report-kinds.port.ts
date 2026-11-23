import type { AggregatedReportData } from '../../modules/reports/aggregated-reports/aggregated-reports.service';
import type { AggregatedReportOptions } from '../../modules/reports/aggregated-reports/templates/aggregated-common';

/**
 * Extension token: the closed aggregated report types (the
 * EU AI Act report) that AggregatedReportsService and ReportBuilderService
 * consult before their core branches (OWASP, CWE, license). Only an ee module
 * supplies it (AggregatedAiActModule); when the token is
 * absent — the Community Edition — no such report type exists.
 */
export const AGGREGATED_REPORT_KINDS = 'AGGREGATED_REPORT_KINDS';

export interface AggregatedReportKind {
  /** The `reportType` of the aggregated report job (`'ai-act'`). */
  readonly reportType: string;
  /** Title of the document, also used in its running PDF footer. */
  readonly title: string;
  /** Aggregate the report's data over the scope's projects. */
  generateData(o: {
    scopeType: string;
    scopeId: string;
    scopeName: string;
    projectIds: string[];
    branchFilter: string;
    projectBranchSelections: { projectId: string; branches: string[] }[];
  }): Promise<AggregatedReportData>;
  /** Render the HTML document (`forPdf` for the print variant). */
  render(options: AggregatedReportOptions, forPdf: boolean): string;
}
