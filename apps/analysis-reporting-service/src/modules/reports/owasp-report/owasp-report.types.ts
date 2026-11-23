import { OwaspCategoryData } from './constants/owasp-data.constants';
import { ReportFindingAnalysis } from '../../../edition/ports/report-analysis.port';

/** Exploitability assessment carried by a detection (static, agent or manual). */
export interface OwaspExploitability {
  verdict: string;
  /** `agent` (AI agent), `manual` (reviewer) or `static` (heuristic). */
  source: string;
  /** 0..1 confidence of the verdict. */
  score: number | null;
  reason: string | null;
}

export interface MappedVulnerability {
  id: string;
  type: 'sast' | 'iac' | 'sca' | 'container';
  name: string;
  description: string;
  severity: string;
  state: string;
  priority: string;
  language?: string;
  path?: string;
  /** `start-end` line range (SAST / IaC). */
  line?: string;
  packageName?: string;
  packageVersion?: string;
  /** Smallest fixed version above the installed one (SCA / container). */
  fixedVersion?: string;
  cvssScore?: number;
  cve?: string;
  /** OSV advisory id (GHSA-…, PYSEC-…) of an SCA finding. */
  advisoryId?: string;
  /** Scanned image of a container finding. */
  imageName?: string;
  /** SCA / container: the advisory was withdrawn by its publisher (OSV). */
  withdrawn?: boolean;
  cwe: string[];
  owaspTop10: string[];
  exploitability?: OwaspExploitability;
  /** Analysis a closed extension attached, secrets masked (detailed report). */
  cybeAnalysis?: ReportFindingAnalysis;
  createdAt: Date;
  updatedAt: Date;
}

export interface OwaspCategoryWithVulnerabilities {
  categoryData: OwaspCategoryData;
  vulnerabilities: MappedVulnerability[];
  count: number;
}

export interface ScanMetadata {
  projectId: string;
  // Readable project name (resolved via global-management). Optional: absent
  // when the gRPC resolution fails (fail-soft); the header falls back to the UUID.
  projectName?: string;
  // Scanned branch. Absent / empty = report aggregated over all branches.
  branch?: string;
  scanDate: string;
  scanDuration?: string;
  profileUsed?: string;
}

export interface OwaspReportData {
  projectId: string;
  generatedAt: string;
  scanMetadata: ScanMetadata;
  summary: {
    totalVulnerabilities: number;
    byType: { sast: number; iac: number; sca: number; container: number };
    bySeverity: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      unknown: number;
    };
    byState: Record<string, number>;
    byOwaspCategory: Record<string, number>;
    /** Findings that belong to no OWASP Top 10 2021 category. */
    unmapped?: number;
  };
  /** Categories with at least one finding; each finding sits in exactly one. */
  owaspCategories: OwaspCategoryWithVulnerabilities[];
  vulnerabilities: MappedVulnerability[];
}
