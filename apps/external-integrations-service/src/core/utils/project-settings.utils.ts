import {
  ProjectGetRequest,
  ProjectInformationsResponse,
} from '@grpc/global-management/project';

/**
 * A repository scan triggered here reads only the project's own
 * settings (the scan-on-commit opt-out and the enabled scanners). The lean
 * ProjectService/Get skips the vulnerability stats (analysis-reporting), the
 * integration status and the security context. A global-management that
 * predates these flags ignores them and answers the full read.
 */
export function projectSettingsRequest(projectId: string): ProjectGetRequest {
  return {
    projectId,
    skipVulnerabilityStats: true,
    skipIntegrationStatus: true,
    skipSecurityContext: true,
  };
}

/** The scan types a repository scan runs, from the project settings. */
export function repositoryScanTypes(
  project: Pick<
    ProjectInformationsResponse,
    'sastEnabled' | 'iacEnabled' | 'scaEnabled'
  >,
): string {
  const types: string[] = [];
  if (project.sastEnabled) types.push('sast');
  if (project.iacEnabled) types.push('iac');
  if (project.scaEnabled) types.push('sca');
  return types.join(',');
}

/**
 * What a push webhook reads from the project, once. `typeScan` is absent when
 * the read failed: the scan start then reads the types itself and fails
 * closed, as it always did, while the opt-out fails open.
 */
export interface PushProjectSettings {
  scanOnCommitEnabled: boolean;
  typeScan?: string;
  /**
   * Whether the project is an AppSec project: a push
   * scans an AppSec project with AppSec, any other one graph-only when
   * the graph-only product is active (`decidePushScan`). Absent
   * when the read failed or global-management predates the field: unknown,
   * and the push keeps its former behaviour.
   */
  appsecProject?: boolean;
}

/**
 * The settings a push reads from the project, with the edition's reading of
 * whether it is an AppSec project (EntitlementsPort.projectProductMark).
 */
export function pushProjectSettings(
  project: Pick<
    ProjectInformationsResponse,
    'scanOnCommitEnabled' | 'sastEnabled' | 'iacEnabled' | 'scaEnabled'
  >,
  appsecProject: boolean | undefined,
): PushProjectSettings {
  return {
    scanOnCommitEnabled: project.scanOnCommitEnabled !== false,
    typeScan: repositoryScanTypes(project),
    ...(typeof appsecProject === 'boolean' ? { appsecProject } : {}),
  };
}
