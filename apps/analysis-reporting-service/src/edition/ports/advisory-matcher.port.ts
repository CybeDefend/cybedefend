import type { VulnerabilityOsvAffected } from '../../entities/osv';
import type { ScannedLibrary } from '../../modules/sca/scanned-library';

/**
 * Extension token: the advisory matcher ScaService
 * runs on every scanned package. Only an ee module supplies it (the OSV
 * mirror's matcher); when the token is absent — the Community Edition — a
 * scanner batch stores its packages and matches nothing.
 */
export const ADVISORY_MATCHER = 'ADVISORY_MATCHER';

export interface AdvisoryMatcher {
  /** One list per library, in order: what OsvMatcherService.findMatchingVulnerabilitiesForLibraries returns today. */
  findMatchingVulnerabilitiesForLibraries(
    libraries: ScannedLibrary[],
  ): Promise<VulnerabilityOsvAffected[][]>;
}
