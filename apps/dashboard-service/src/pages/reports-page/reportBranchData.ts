import {
  getBatchProjectsBranches,
  BatchProjectsBranchesEntry,
} from '@/server/services/resultService';

/** Max projectIds the batch endpoint accepts per request (mirrors the DTO cap). */
const BATCH_LIMIT = 100;

export interface ReportBranchMaps {
  /** Active branch names per project, excluding archived ones. */
  branchesMap: Record<string, string[]>;
  /** Archived branch names per project. */
  archivedBranchesMap: Record<string, string[]>;
}

/**
 * Fetch active + archived branches for many projects in as few requests as
 * possible. Replaces the reports page's old per-project fan-out (one active +
 * one archived GET per project = 2×N requests) with the org-scoped batch
 * endpoint. Project ids are chunked to the endpoint's cap and the chunks run
 * in parallel, so even a 250-project org issues 3 requests instead of 500.
 */
export const fetchReportBranchMaps = async (
  organizationId: string,
  projectIds: string[],
): Promise<ReportBranchMaps> => {
  const branchesMap: Record<string, string[]> = {};
  const archivedBranchesMap: Record<string, string[]> = {};

  if (!organizationId || projectIds.length === 0) {
    return { branchesMap, archivedBranchesMap };
  }

  const chunks: string[][] = [];
  for (let i = 0; i < projectIds.length; i += BATCH_LIMIT) {
    chunks.push(projectIds.slice(i, i + BATCH_LIMIT));
  }

  const responses: { projects: BatchProjectsBranchesEntry[] }[] =
    await Promise.all(
      chunks.map((ids) => getBatchProjectsBranches(organizationId, ids)),
    );

  for (const { projects } of responses) {
    for (const entry of projects) {
      const archived = entry.archivedBranches ?? [];
      const archivedSet = new Set(archived);
      archivedBranchesMap[entry.projectId] = archived;
      // Active list excludes anything already archived (mirrors the previous
      // per-project merge on the reports page).
      branchesMap[entry.projectId] = (entry.branches ?? []).filter(
        (name) => !archivedSet.has(name),
      );
    }
  }

  return { branchesMap, archivedBranchesMap };
};
