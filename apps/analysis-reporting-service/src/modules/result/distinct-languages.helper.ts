import { ObjectLiteral, Repository } from 'typeorm';

/**
 * Returns the distinct, non-empty, alphabetically-sorted languages
 * present for a project's vulnerabilities in the given detection repository,
 * optionally scoped to a branch.
 *
 * This is the single source of truth for the "language" filter facet. It is
 * reused by:
 *  - the detailed list builders (SastIacService), and
 *  - the grouped list builders (GroupedVulnerabilityService),
 * so the frontend dropdown can be populated inline from the list responses
 * (the facet rides along with each paginated list response).
 *
 * The facet is intentionally independent of pagination and of the
 * severity/status/priority/language filters: it always reflects the full
 * distinct set for the project/type/branch — which is exactly what the filter
 * dropdown needs (deriving it from the paginated, self-filtered page would be
 * incorrect).
 */
export async function fetchDistinctVulnerabilityLanguages<
  T extends ObjectLiteral,
>(
  repository: Repository<T>,
  projectId: string,
  branch?: string,
  onError?: (error: unknown) => void,
): Promise<string[]> {
  try {
    const queryBuilder = repository
      .createQueryBuilder('vulnDetection')
      .select('DISTINCT vulnDetection.language', 'language')
      .where('vulnDetection.projectId = :projectId', { projectId })
      .andWhere('vulnDetection.language IS NOT NULL')
      .andWhere("vulnDetection.language <> ''")
      .orderBy('vulnDetection.language', 'ASC');

    if (branch) {
      queryBuilder.andWhere('vulnDetection.branch = :branch', { branch });
    }

    const rows = await queryBuilder.getRawMany<{ language: string }>();

    return rows.map((row) => row.language);
  } catch (error) {
    // the facet is best-effort. It runs inside the same
    // Promise.all as the critical list/count/scan queries at every call site, so
    // a failure here (DB timeout, lock contention, missing index under load) must
    // NEVER reject that Promise.all and take down the whole list response.
    // Degrade to an empty list — the frontend simply shows an empty dropdown.
    onError?.(error);
    return [];
  }
}
