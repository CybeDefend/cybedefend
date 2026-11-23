import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';

import { projectWithDefaultBranchRequest } from '../../core/utils/project-read.util';

import { scopingBranchesFor } from './branch-scoping.util';

// The cascade and the "all branches" sentinels moved to `branch-scoping.util`
// when the GRC findings export needed the same rule from cheaper inputs. This
// resolver still owns HOW the inputs are fetched (one gRPC call per project);
// it no longer owns what they mean.

/**
 * The two branch-scoping fields of a global-management project. Structural, so
 * a caller hands over the `ProjectService/Get` response it already holds.
 */
export interface BranchScopingProject {
  referenceBranch?: string | null;
  defaultBranch?: string | null;
}

/**
 * The scoring branches of a project the caller has ALREADY
 * loaded: the same answer as `ReferenceBranchResolver.getScoringBranches`
 * (which goes through this function), without a second `ProjectService/Get`.
 * A results list needs the project anyway; asking the resolver as well cost
 * it one more Get per counter.
 *
 * `null`/`undefined` stands for a Get that failed and yields main/master, the
 * resolver's fallback: a branch lookup never widens the scope to every branch.
 */
export function scoringBranchesFromProject(
  project: BranchScopingProject | null | undefined,
): string[] {
  return scopingBranchesFor(project?.referenceBranch, project?.defaultBranch);
}

const lookupLogger = new Logger('ScoringBranchesFromLookup');

/**
 * {@link scoringBranchesFromProject} over a project lookup still in flight.
 * Never rejects: a failed lookup yields main/master and logs a WARN, as the
 * resolver does. The failure itself still belongs to whoever
 * awaits `projectLookup`: a results list must await it, so that a failed Get
 * fails the list instead of serving it scoped to the fallback.
 *
 * @param projectId - only names the project in the WARN.
 */
export function scoringBranchesFromLookup(
  projectLookup: Promise<BranchScopingProject | null | undefined>,
  projectId?: string,
): Promise<string[]> {
  return projectLookup.then(scoringBranchesFromProject, (e: unknown) => {
    lookupLogger.warn(
      `failed to resolve branch scoping inputs projectId=${
        projectId ?? 'unknown'
      }: ${(e as Error)?.message ?? e}; scoping to main/master`,
    );
    return scoringBranchesFromProject(null);
  });
}

/**
 * Resolves a project's reference branch from global-management so the
 * persisted CybeRisk score (and the /overview breakdown) can be scoped to a
 * single branch instead of summing every branch.
 *
 * Resilient by design: any resolution failure falls back to `null`. Callers go
 * through getScoringBranches()/getScoringBranchesBatch(), which map a
 * null/sentinel reference branch to the default main/master scoring branches —
 * never to "all branches". A branch lookup must never break scoring.
 */
@Injectable()
export class ReferenceBranchResolver implements OnModuleInit {
  private readonly logger = new Logger(ReferenceBranchResolver.name);
  private projectClient!: ProjectServiceClient;

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE') private readonly gm: ClientGrpc,
  ) {}

  onModuleInit() {
    this.projectClient =
      this.gm.getService<ProjectServiceClient>(PROJECT_SERVICE_NAME);
  }

  /**
   * Fetches a project's branch-scoping inputs in a single gRPC round-trip: the
   * user-configured referenceBranch and the repo's git defaultBranch (resolved
   * by global-management from the linked GitHub/GitLab integration). Resilient:
   * any failure yields both-null so scoring falls back to main/master.
   */
  private async getBranchScopingInputs(
    projectId: string,
  ): Promise<{ referenceBranch: string | null; defaultBranch: string | null }> {
    try {
      // referenceBranch is a project column, defaultBranch comes
      // from the integration status. Skip the vulnerability stats (which
      // global-management fetched from this service) and the security context.
      const project = await firstValueFrom(
        this.projectClient.get(projectWithDefaultBranchRequest(projectId)),
      );
      const ref = project?.referenceBranch?.trim();
      const def = project?.defaultBranch?.trim();
      return {
        referenceBranch: ref ? ref : null,
        defaultBranch: def ? def : null,
      };
    } catch (e) {
      this.logger.warn(
        `failed to resolve branch scoping inputs projectId=${projectId}: ${
          (e as Error)?.message ?? e
        }`,
      );
      return { referenceBranch: null, defaultBranch: null };
    }
  }

  async getReferenceBranch(projectId: string): Promise<string | null> {
    return (await this.getBranchScopingInputs(projectId)).referenceBranch;
  }

  /**
   * Resolves the branches a project's score is scoped to:
   *  1. the user-configured referenceBranch when set to a real branch;
   *  2. otherwise the repo's git defaultBranch — so a project whose
   *     main branch isn't named main/master is scored on the branch its vulns
   *     actually live on;
   *  3. otherwise the main/master fallback.
   * An "all branches" sentinel (e.g. 'all', '*') in either field is treated as
   * unset and skipped.
   */
  async getScoringBranches(projectId: string): Promise<string[]> {
    return scoringBranchesFromProject(
      await this.getBranchScopingInputs(projectId),
    );
  }

  /**
   * Batch variant of getScoringBranches used by the live 7-day KPI so it stays
   * branch-scoped like the persisted score. Resolution runs in parallel — one
   * gRPC project lookup per id (getReferenceBranch already swallows failures and
   * falls back to main/master), so a branch lookup never breaks the KPI. Returns
   * an empty Map for an empty input without touching gRPC.
   */
  async getScoringBranchesBatch(
    projectIds: string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (projectIds.length === 0) return out;
    const branches = await Promise.all(
      projectIds.map((projectId) => this.getScoringBranches(projectId)),
    );
    projectIds.forEach((projectId, i) => out.set(projectId, branches[i]));
    return out;
  }
}
