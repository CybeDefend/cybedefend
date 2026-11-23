import { ProjectBranch } from '@/server/interfaces/Vulnerability';

/**
 * Resolve the branch a freshly-loaded project Reports page should target.
 *
 * The project Reports page no longer offers an "All branches" option — every
 * generated report (OWASP / CWE / EU AI Act) must be scoped to a single
 * concrete branch. This picks the initial selection, in order of preference:
 *   1. the project's reference branch when it declares one,
 *   2. otherwise the first non-archived branch,
 *   3. otherwise the first branch of any kind (archived-only projects),
 *   4. `null` only when the project has no named branches at all — the selector
 *      is then hidden and reports stay project-wide (legacy behaviour).
 */
export function selectDefaultReportBranch(
  branches: ProjectBranch[],
  referenceBranch: string | null,
): string | null {
  if (referenceBranch) return referenceBranch;
  const firstActive = branches.find((b) => !b.archived);
  if (firstActive) return firstActive.name;
  return branches[0]?.name ?? null;
}
