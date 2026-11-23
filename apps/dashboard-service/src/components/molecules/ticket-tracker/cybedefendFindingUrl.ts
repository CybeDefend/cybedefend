import {
  buildVulnerabilityUrl,
  isScanType,
} from '@/utils/function/buildVulnerabilityUrl';
import { projectPath } from '@/utils/product';

/**
 * The « Open in CybeDefend » link external-integrations prints in a Jira or
 * Linear ticket created from the dashboard: the AppSec finding route, which
 * opens the results list of its scanner with the drawer on that finding.
 *
 * The scanner types the results tables pass (`sast`, `iac`, `cicd`, `secret`,
 * `sca`, `container`) are the URL segments of the results pages. Any other
 * value has no results page to open, so the link leads to the project's AppSec
 * overview rather than to a URL no route matches.
 */
export const cybedefendFindingUrl = (
  origin: string,
  projectId: string,
  scannerType: string,
  vulnerabilityId: string,
): string =>
  `${origin}${
    isScanType(scannerType)
      ? buildVulnerabilityUrl(projectId, scannerType, vulnerabilityId)
      : projectPath('appsec', encodeURIComponent(projectId))
  }`;
