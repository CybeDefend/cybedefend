import { ProjectServiceClient } from '@grpc/global-management/global_management';
import { ProjectInformationsResponse } from '@grpc/global-management/project';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';

import {
  BranchScopingProject,
  scoringBranchesFromLookup,
} from '../cyber-risk/reference-branch.resolver';

/**
 * SCA "effective branch" resolution.
 *
 * SCA packages (`sca_detected_packages`) and detections
 * (`vulnerability_detections_sca`) are partitioned by a literal `branch` value.
 * A scan run without an explicit branch is stored as NULL by security-scanning
 * and read back as `''`, and `''` is also the legacy column default — so the
 * empty-string partition is, logically, the project's DEFAULT branch.
 *
 * This helper maps a raw branch (from a scan or a read request) to the SET of
 * branch partition values that constitute its single logical branch, using the
 * project's canonical scoring branches (`ReferenceBranchResolver`):
 *
 *  - empty / absent / one of the scoring branches → the default partition =
 *    `{ ...scoringBranches, '' }` (so legacy `''` rows and default-branch rows
 *    are unified, and the resolver heals the `''` ↔ `main` cross-scan drift);
 *  - a real feature branch (not among the scoring branches) → strictly itself,
 *    so genuine multi-branch SCA never cross-resolves or cross-reads.
 */
export function resolveScaEffectiveBranches(
  scoringBranches: readonly string[],
  rawBranch?: string | null,
): string[] {
  const normalized = (rawBranch ?? '').trim();
  const scoring = (scoringBranches ?? [])
    .map((b) => (b ?? '').trim())
    .filter((b) => b.length > 0);

  if (normalized !== '') {
    // A specific canonical/default branch folds in ONLY the legacy '' partition
    // — never the SIBLING fallback branches (e.g. asking for 'main' must not
    // drag in 'master'), so the resolver can't cross-resolve a separate branch.
    if (scoring.includes(normalized)) {
      return Array.from(new Set([normalized, '']));
    }
    // A real feature branch is its own partition.
    return [normalized];
  }

  // No branch specified → the whole default partition: every canonical scoring
  // branch plus the legacy '' partition.
  return Array.from(new Set([...scoring, '']));
}

/**
 * {@link resolveScaEffectiveBranches} for a caller that is
 * already reading the project (a results list needs its name anyway): the
 * scoring branches come from that `ProjectService/Get` instead of a second one
 * through `ReferenceBranchResolver.getScoringBranches`.
 *
 * Never rejects: a failed lookup yields the main/master partition and a WARN,
 * as the resolver does; the failure itself stays with whoever awaits the
 * lookup.
 */
export function scaEffectiveBranchesFromLookup(
  projectLookup: Promise<BranchScopingProject | null | undefined>,
  rawBranch?: string | null,
  projectId?: string,
): Promise<string[]> {
  return scoringBranchesFromLookup(projectLookup, projectId).then(
    (scoringBranches) =>
      resolveScaEffectiveBranches(scoringBranches, rawBranch),
  );
}

/**
 * The ONE `ProjectService/Get` of a results list, and the
 * SCA logical branch partition derived from it. The counters returned
 * alongside the list take that partition instead of resolving it through
 * getScoringBranches, which cost one more Get each; it is the partition the
 * SCA list reads, so a tab badge never disagrees with the list.
 *
 * The list MUST await `projectLookup`: a failed Get fails the list with its
 * gRPC status (`safeGrpcCall`), while `scaBranches` falls back to main/master,
 * as the resolver does.
 */
export function lookupProjectWithScaBranches(
  projectServiceClient: Pick<ProjectServiceClient, 'get'>,
  projectId: string,
  rawBranch?: string | null,
): {
  projectLookup: Promise<ProjectInformationsResponse>;
  scaBranches: Promise<string[]>;
} {
  const projectLookup = safeGrpcCall<ProjectInformationsResponse>(
    projectServiceClient.get({ projectId }),
  );
  return {
    projectLookup,
    scaBranches: scaEffectiveBranchesFromLookup(
      projectLookup,
      rawBranch,
      projectId,
    ),
  };
}
