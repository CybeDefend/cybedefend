import {
  IssueCreationMode,
  VulnerabilityInfo,
} from '@grpc/external-integrations/issue';

/**
 * How findings are grouped into tickets, shared by the Jira and Linear
 * integrations (moved from JiraIssueService unchanged).
 */
export type NormalizedIssueCreationMode =
  | 'per_vulnerability'
  | 'per_vulnerability_type'
  | 'per_file';

/**
 * The creation mode as stored in `vulnerability_issue_mapping.creationMode`.
 * Accepts the enum value, its number as a string, or its name (a gRPC loader
 * may send enums as strings); anything else is per vulnerability type.
 */
export function normalizeIssueCreationMode(
  mode: IssueCreationMode | string | number,
): NormalizedIssueCreationMode {
  if (typeof mode === 'string') {
    const modeStr = mode.toString().toUpperCase();
    if (modeStr.includes('PER_VULNERABILITY_TYPE'))
      return 'per_vulnerability_type';
    if (modeStr.includes('PER_FILE')) return 'per_file';
    if (modeStr.includes('PER_VULNERABILITY')) return 'per_vulnerability';
    const num = parseInt(mode, 10);
    if (!isNaN(num)) return modeNumToString(num);
    return 'per_vulnerability_type';
  }
  return modeNumToString(Number(mode));
}

function modeNumToString(mode: number): NormalizedIssueCreationMode {
  switch (mode) {
    case IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY:
      return 'per_vulnerability';
    case IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE:
      return 'per_vulnerability_type';
    case IssueCreationMode.ISSUE_CREATION_MODE_PER_FILE:
      return 'per_file';
    default:
      return 'per_vulnerability_type';
  }
}

function getUniqueDetectionKey(vuln: VulnerabilityInfo): string {
  if (vuln.scannerType?.toLowerCase() === 'sca') {
    return `${vuln.vulnerabilityId}:${vuln.packageName || 'unknown'}@${vuln.packageVersion || 'unknown'}`;
  }
  return `${vuln.vulnerabilityId}:${vuln.filePath || 'unknown'}:${vuln.startLine || 0}`;
}

/** The findings of each ticket, by group key, in the order they came. */
export function groupVulnerabilities(
  vulnerabilities: VulnerabilityInfo[],
  mode: IssueCreationMode,
): Map<string, VulnerabilityInfo[]> {
  const groups = new Map<string, VulnerabilityInfo[]>();
  const normalizedMode = normalizeIssueCreationMode(mode);

  for (const vuln of vulnerabilities) {
    let key: string;

    if (normalizedMode === 'per_vulnerability') {
      key = getUniqueDetectionKey(vuln);
    } else if (normalizedMode === 'per_vulnerability_type') {
      key = vuln.externalId || vuln.name || vuln.vulnerabilityId;
    } else if (normalizedMode === 'per_file') {
      key =
        vuln.scannerType?.toLowerCase() === 'sca'
          ? `SCA:${vuln.filePath || 'dependencies'}`
          : `${vuln.scannerType || 'SAST'}:${vuln.filePath || 'unknown'}`;
    } else {
      key = vuln.externalId || vuln.name || vuln.vulnerabilityId;
    }

    const existing = groups.get(key) || [];
    existing.push(vuln);
    groups.set(key, existing);
  }

  return groups;
}

/**
 * Build the direct CybeDefend URL for the grouped vulnerability view.
 * Format: {baseUrl}/project/{projectId}/{scannerType}?search={vulnName}
 */
export function buildCybeDefendGroupUrl(
  cybedefendBaseUrl: string,
  projectId: string,
  scannerType: string,
  vulnName: string,
): string {
  const type = scannerType?.toLowerCase() || 'sast';
  const searchParam = encodeURIComponent(vulnName);
  return `${cybedefendBaseUrl}/project/${projectId}/${type}?search=${searchParam}`;
}

/**
 * Build a human-readable name for a vulnerability.
 * For SCA vulnerabilities with GHSA/CVE IDs, prefer packageName + shortDescription.
 */
export function vulnerabilityDisplayName(vuln: VulnerabilityInfo): string {
  const name = vuln.name || '';
  const isGhsaOrCve = name.startsWith('GHSA-') || name.startsWith('CVE-');

  if (isGhsaOrCve) {
    if (vuln.packageName && vuln.shortDescription) {
      return `${vuln.packageName}: ${vuln.shortDescription}`;
    }
    if (vuln.packageName) {
      return `${vuln.packageName} (${name})`;
    }
    if (vuln.shortDescription) {
      return vuln.shortDescription;
    }
  }
  return name || vuln.externalId || 'Vulnerability';
}
