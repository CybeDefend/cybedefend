import type { GeneratedReportKind } from '../../entities/generated-report.entity';
import type { ReportJobData } from '../../modules/scan-queue/scan-queue.service';
import type { UploadedReport } from '../../modules/reports/shared/report-upload.service';

/**
 * Extension token: the closed per-project report
 * generators (per-scanner and EU AI Act reports) that ReportsQueueProcessor
 * hands a job to when its kind is not one the core builds inline (OWASP,
 * CWE). Only an ee module supplies it (ReportGeneratorsModule);
 * when the token is absent — the Community Edition — such a job fails
 * with « Unknown report kind ».
 */
export const PROJECT_REPORT_GENERATORS = 'PROJECT_REPORT_GENERATORS';

export interface ProjectReportGenerator {
  readonly kind: GeneratedReportKind;
  /** Build the report bytes for the job and upload them. */
  buildAndUpload(data: ReportJobData): Promise<UploadedReport>;
}
