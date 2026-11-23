import { CweData } from './constants/cwe-data.constants';
import { ReportFindingAnalysis } from '../../../edition/ports/report-analysis.port';

export type FindingType = 'sast' | 'iac' | 'sca' | 'container';

/** Exploitability verdict carried by a detection (agent, manual review or
 * static heuristic). Only `agent` and `manual` are shown to the reader. */
export interface MappedExploitability {
  verdict: string;
  source: string;
  /** Exploitability score 0-1 (shown as a %). */
  score?: number | null;
  reason?: string | null;
}

export interface MappedVulnerability {
  id: string;
  type: FindingType;
  name: string;
  description: string;
  severity: string;
  state: string;
  priority: string;
  language?: string;
  path?: string;
  /** `start-end` (SAST / IaC). */
  line?: string;
  packageName?: string;
  packageVersion?: string;
  fixedVersion?: string;
  /** Manifest where the package is declared (SCA). */
  manifest?: string;
  /** Scanned image (container). */
  image?: string;
  /** Identifiant de l'advisory OSV/GHSA (SCA, conteneur). */
  advisoryId?: string;
  /** Advisory withdrawn by its source (OSV `withdrawn`): counted as on the
   * dashboard, flagged to the reader. */
  withdrawn?: boolean;
  /** Development dependency, not shipped in the built application (SCA). */
  devDependency?: boolean;
  cvssScore?: number;
  cve?: string;
  cwe: string[];
  exploitability?: MappedExploitability;
  /** Analysis a closed extension attached, secrets masked (detailed report). */
  cybeAnalysis?: ReportFindingAnalysis;
  createdAt: Date;
  updatedAt: Date;
}

export interface CweCategoryWithVulnerabilities {
  cweData: CweData;
  /** Every finding attached to the category (open, then triaged). */
  vulnerabilities: MappedVulnerability[];
  /** OPEN findings of the category (triaged findings do not count). */
  count: number;
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

/** Summary over the Top 25 scope: open findings, deduplicated. */
export interface Top25Summary {
  findings: number;
  categoriesAffected: number;
  bySeverity: SeverityCounts;
  byType: Record<FindingType, number>;
  /** Triaged Top 25 findings (ignored, resolved, not exploitable), excluded. */
  triaged: number;
}

export interface ScanMetadata {
  projectId: string;
  // Readable project name (resolved via global-management). Optional: absent
  // when the gRPC resolution fails (fail-soft); the header falls back to the UUID.
  projectName?: string;
  // Scanned branch. Absent / empty = report aggregated over all branches.
  branch?: string;
}

export interface CweReportData {
  projectId: string;
  generatedAt: string;
  scanMetadata: ScanMetadata;
  summary: {
    /** Every finding of the project, all categories and states. */
    totalVulnerabilities: number;
    /** Open findings of the project, all categories. */
    openFindings?: number;
    byType: { sast: number; iac: number; sca: number; container: number };
    bySeverity: SeverityCounts;
    byState: Record<string, number>;
    byCweCategory: Record<string, number>;
    top25?: Top25Summary;
  };
  cweCategories: CweCategoryWithVulnerabilities[];
  vulnerabilities: MappedVulnerability[];
}
