import { DEFAULT_SCORING_BRANCHES } from './cyber-risk.constants';

/**
 * Branch-scoping vocabulary, shared by every read path that must answer for ONE
 * branch rather than for the sum of all of them.
 *
 * It lives in its own module because two consumers need the same answer and a
 * rule copied twice drifts: `ReferenceBranchResolver` (CybeRisk scoring, which
 * can afford a gRPC lookup per project) and the GRC findings export (which
 * cannot — it is paginated, so a per-project lookup would run once per page).
 * They differ in HOW they obtain the inputs; they must not differ in what they
 * conclude from them.
 */

/**
 * Some projects store a literal "every branch" marker instead of leaving the
 * reference branch null. Scoping to a branch named `*` would match nothing, so
 * these are read as "unset" and fall through to the default.
 */
const ALL_BRANCHES_SENTINELS = new Set([
  'all',
  'all_branches',
  'all-branches',
  'all branches',
  '*',
]);

export function isAllBranchesSentinel(branch: string): boolean {
  return ALL_BRANCHES_SENTINELS.has(branch.trim().toLowerCase());
}

/**
 * The branches a project's answer is scoped to, given its already-resolved
 * inputs. Pure: the caller decides how expensive it is willing to be to obtain
 * them.
 *
 * The cascade, in order:
 *   1. the user-configured `referenceBranch` when it names a real branch;
 *   2. the repository's git default branch — so a project whose main
 *      branch is called neither `main` nor `master` is answered on the branch
 *      its findings actually live on;
 *   3. the `main`/`master` fallback.
 *
 * NEVER "all branches". A caller that cannot establish a scope gets the default,
 * not the union: summing branches double-counts one finding per branch it was
 * detected on, and for an export it would hand a GRC platform two work items
 * for one problem.
 *
 * @param referenceBranch - configured on the project, or null/'' when unset.
 * @param defaultBranch - the repo's git default. Callers that cannot obtain it
 *   cheaply pass null and accept step 2 being skipped; state that where you do.
 */
export function scopingBranchesFor(
  referenceBranch: string | null | undefined,
  defaultBranch: string | null | undefined,
): string[] {
  const configured = referenceBranch?.trim();
  if (configured && !isAllBranchesSentinel(configured)) {
    return [configured];
  }
  const gitDefault = defaultBranch?.trim();
  if (gitDefault && !isAllBranchesSentinel(gitDefault)) {
    return [gitDefault];
  }
  return [...DEFAULT_SCORING_BRANCHES];
}
