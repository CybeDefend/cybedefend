import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { Span } from 'nestjs-otel';
import { FindOptionsWhere, In, IsNull, Like, Not, Repository } from 'typeorm';
import { GithubRepository } from '../../entities/github-repository.entity';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import { GithubService } from '../github/github.service';
import { GitlabService } from '../gitlab/gitlab.service';

export interface ProjectIntegrationLinkStatus {
  isGithubLinked: boolean;
  isGitlabLinked: boolean;
  isJiraLinked: boolean;
  isLinearLinked: boolean;
  // The linked repository's git default branch (GitHub preferred, then
  // GitLab), or '' when the project has no git integration. Lets analysis-reporting
  // scope the (branch-scoped) cyberisk score to the real default branch instead of
  // a hardcoded main/master fallback when no referenceBranch is configured.
  defaultBranch: string;
  // The linked repository, with the same GitHub-then-GitLab precedence as
  // defaultBranch; undefined when the project has none. The dashboard reads
  // its branches with this id instead of listing every repository of the org.
  linkedRepository: LinkedRepository | undefined;
}

export interface LinkedRepository {
  provider: 'github' | 'gitlab';
  // github_repositories.id / gitlab_repositories.id — the id the repository
  // branches routes take.
  repositoryId: string;
}

export interface BatchProjectIntegrationLinkStatus {
  statuses: Array<{
    projectId: string;
    isGithubLinked: boolean;
    isGitlabLinked: boolean;
    // Same precedence as ProjectIntegrationLinkStatus.defaultBranch.
    defaultBranch: string;
  }>;
  isJiraLinked: boolean;
  isLinearLinked: boolean;
}

export interface RepositoryProjectMatchResult {
  matches: Array<{
    projectId: string;
    organizationId: string;
    provider: string;
    repositoryFullName: string;
  }>;
}

/** The longest branch name a scan stores (the scan's branch column). */
const MAX_BRANCH_NAME_LENGTH = 255;

/**
 * How long a container scan sent without a branch waits for its reference
 * branch to be checked before it takes the repository's default branch. A
 * GitHub call may take 30 s and be retried, a GitLab one has no timeout, and
 * security-scanning gives up after 20 s (BRANCH_RESOLUTION_TIMEOUT_MS): past
 * that, the scan would be refused, which a scan sent without a branch never is.
 */
export const REFERENCE_BRANCH_CHECK_TIMEOUT_MS = 5_000;

/**
 * `work`, or a rejection once `ms` have passed. The timer is cleared as soon
 * as either settles; a call past the deadline runs on and its answer is
 * dropped.
 */
function withinDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer within ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** A branch as sent: trimmed, without the "refs/heads/" some CIs send. */
function asBranchName(value: string | undefined): string {
  return (value ?? '').trim().replace(/^refs\/heads\//, '');
}

/** Cap on repository -> project matches returned by resolveProjectsByRepository. */
const RESOLVE_MATCHES_LIMIT = 20;

/**
 * Escapes SQL LIKE wildcards (% and _, plus the backslash escape char itself)
 * in caller-provided input so a host like '%' cannot neutralize the webUrl
 * filter and conflate same-slug repositories across GitLab instances. MySQL's
 * default ESCAPE character is backslash.
 */
function escapeLikeWildcards(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Aggregates GitHub / GitLab / Jira / Linear link status into one call.
 * Callers that historically fanned out to three RPCs (GithubService,
 * GitlabService, plus a Jira installation lookup) hit this service instead,
 * halving the round-trips required to assemble the project payload in
 * global-management. Jira and Linear are organization-scoped: the flag is the
 * same for every project of an organization.
 */
@Injectable()
export class ProjectIntegrationStatusService {
  constructor(
    private readonly logger: Logger,
    @InjectRepository(GithubRepository)
    private readonly githubRepo: Repository<GithubRepository>,
    @InjectRepository(GitlabRepository)
    private readonly gitlabRepo: Repository<GitlabRepository>,
    @InjectRepository(JiraIntegration)
    private readonly jiraRepo: Repository<JiraIntegration>,
    @InjectRepository(LinearIntegration)
    private readonly linearRepo: Repository<LinearIntegration>,
    private readonly githubService: GithubService,
    private readonly gitlabService: GitlabService,
  ) {}

  /**
   * The branch a container scan is stored on. The dashboard shows
   * a project linked to GitHub or GitLab on that repository's branches only,
   * so a scan stored on anything else (an image tag sent as the branch, the
   * empty branch) was saved and then never shown.
   *
   * - Linked: a requested branch must exist in the repository, and is stored
   *   as the repository spells it (INVALID_ARGUMENT when it does not; a failed
   *   check goes through as is). With none requested, never a refusal: the
   *   reference branch when the repository has it, else the repository's
   *   default branch, else main, even when the check fails or takes longer
   *   than REFERENCE_BRANCH_CHECK_TIMEOUT_MS.
   * - Not linked: nothing to check against, so the requested branch as is,
   *   else the reference branch, else main.
   *
   * A leading "refs/heads/" (what some CIs send) is dropped. Same
   * GitHub-then-GitLab order as getProjectIntegrationLinkStatus, but a failed
   * lookup fails: it must not pass for "no repository".
   */
  @Span()
  async resolveScanBranch(input: {
    projectId: string;
    branch: string;
    referenceBranch: string;
  }): Promise<string> {
    const requested = asBranchName(input.branch);
    const reference = asBranchName(input.referenceBranch);
    if (requested.length > MAX_BRANCH_NAME_LENGTH) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `A branch name is at most ${MAX_BRANCH_NAME_LENGTH} characters.`,
      });
    }

    const [github, gitlab] = await Promise.all([
      this.githubRepo.findOne({
        where: { projectId: input.projectId },
        relations: ['integration'],
      }),
      this.gitlabRepo.findOne({
        where: { projectId: input.projectId },
        relations: ['integration'],
      }),
    ]);
    const linked = github
      ? {
          name: github.fullName,
          defaultBranch: github.defaultBranch,
          find: (branch: string) =>
            this.githubService.findBranch(github, branch),
        }
      : gitlab
        ? {
            name: gitlab.pathWithNamespace,
            defaultBranch: gitlab.defaultBranch,
            find: (branch: string) =>
              this.gitlabService.findBranch(gitlab, branch),
          }
        : null;

    if (!linked) return requested || reference || 'main';

    if (requested) {
      const found = await linked.find(requested);
      if (found) return found;
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message:
          `Branch "${requested}" does not exist in ${linked.name}, the repository linked to this project. ` +
          'Send the git branch the image was built from; the image tag belongs in imageName.',
      });
    }
    if (reference) {
      const found = await withinDeadline(
        linked.find(reference),
        REFERENCE_BRANCH_CHECK_TIMEOUT_MS,
      ).catch((error: unknown) => {
        this.logger.warn(
          `resolveScanBranch could not check the reference branch of ${input.projectId}, using the default branch: ${(error as Error)?.message}`,
        );
        return null;
      });
      if (found) return found;
    }
    return linked.defaultBranch || 'main';
  }

  @Span()
  async getProjectIntegrationLinkStatus(input: {
    projectId: string;
    organizationId: string;
  }): Promise<ProjectIntegrationLinkStatus> {
    const [github, gitlab, jira, linear] = await Promise.all([
      this.githubRepo
        .findOne({ where: { projectId: input.projectId } })
        .catch((err) => {
          this.logger.warn(
            `getProjectIntegrationLinkStatus github lookup failed for ${input.projectId}: ${err}`,
          );
          return null;
        }),
      this.gitlabRepo
        .findOne({ where: { projectId: input.projectId } })
        .catch((err) => {
          this.logger.warn(
            `getProjectIntegrationLinkStatus gitlab lookup failed for ${input.projectId}: ${err}`,
          );
          return null;
        }),
      this.jiraRepo
        .findOne({ where: { organizationId: input.organizationId } })
        .catch((err) => {
          this.logger.warn(
            `getProjectIntegrationLinkStatus jira lookup failed for ${input.organizationId}: ${err}`,
          );
          return null;
        }),
      this.linearRepo
        .findOne({ where: { organizationId: input.organizationId } })
        .catch((err) => {
          this.logger.warn(
            `getProjectIntegrationLinkStatus linear lookup failed for ${input.organizationId}: ${err}`,
          );
          return null;
        }),
    ]);

    return {
      isGithubLinked: !!github,
      isGitlabLinked: !!gitlab,
      isJiraLinked: !!jira,
      isLinearLinked: !!linear,
      // Prefer the GitHub repo's default branch, then GitLab's; '' when neither
      // is linked (or the field was never synced from the provider).
      defaultBranch: github?.defaultBranch || gitlab?.defaultBranch || '',
      linkedRepository: github
        ? { provider: 'github', repositoryId: github.id }
        : gitlab
          ? { provider: 'gitlab', repositoryId: gitlab.id }
          : undefined,
    };
  }

  @Span()
  async getBatchProjectIntegrationLinkStatus(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<BatchProjectIntegrationLinkStatus> {
    const projectIds = input.projectIds ?? [];

    // Jira and Linear are org-scoped — one lookup each regardless of project
    // count.
    const jiraPromise = this.jiraRepo
      .findOne({ where: { organizationId: input.organizationId } })
      .catch((err) => {
        this.logger.warn(
          `getBatchProjectIntegrationLinkStatus jira lookup failed for ${input.organizationId}: ${err}`,
        );
        return null;
      });
    const linearPromise = this.linearRepo
      .findOne({ where: { organizationId: input.organizationId } })
      .catch((err) => {
        this.logger.warn(
          `getBatchProjectIntegrationLinkStatus linear lookup failed for ${input.organizationId}: ${err}`,
        );
        return null;
      });

    if (projectIds.length === 0) {
      const [jira, linear] = await Promise.all([jiraPromise, linearPromise]);
      return {
        statuses: [],
        isJiraLinked: !!jira,
        isLinearLinked: !!linear,
      };
    }

    const [githubRows, gitlabRows, jira, linear] = await Promise.all([
      this.githubRepo
        .find({ where: { projectId: In(projectIds) } })
        .catch((err) => {
          this.logger.warn(
            `getBatchProjectIntegrationLinkStatus github batch failed: ${err}`,
          );
          return [] as GithubRepository[];
        }),
      this.gitlabRepo
        .find({ where: { projectId: In(projectIds) } })
        .catch((err) => {
          this.logger.warn(
            `getBatchProjectIntegrationLinkStatus gitlab batch failed: ${err}`,
          );
          return [] as GitlabRepository[];
        }),
      jiraPromise,
      linearPromise,
    ]);

    const githubByProject = new Map(githubRows.map((r) => [r.projectId, r]));
    const gitlabByProject = new Map(gitlabRows.map((r) => [r.projectId, r]));

    const statuses = projectIds.map((projectId) => {
      const github = githubByProject.get(projectId);
      const gitlab = gitlabByProject.get(projectId);
      return {
        projectId,
        isGithubLinked: !!github,
        isGitlabLinked: !!gitlab,
        // Same precedence as getProjectIntegrationLinkStatus.
        defaultBranch: github?.defaultBranch || gitlab?.defaultBranch || '',
      };
    });

    return {
      statuses,
      isJiraLinked: !!jira,
      isLinearLinked: !!linear,
    };
  }

  /**
   * Dashboard repository link (task B2) — resolves a git repository slug
   * ("owner/repo" for GitHub, "group/sub/proj" for GitLab) into the CybeDefend
   * project(s) it is linked to. Only repositories already linked to a project
   * (projectId NOT NULL) are considered; organizationId comes from the parent
   * integration. For GitLab, a non-empty host narrows matches to self-hosted
   * instances via webUrl.
   */
  @Span()
  async resolveProjectsByRepository(input: {
    provider: string;
    slug: string;
    host: string;
  }): Promise<RepositoryProjectMatchResult> {
    if (input.provider === 'github') {
      // The github_repositories table only ever holds github.com App repos, so a
      // GitHub-Enterprise origin (e.g. github.corp.com) must not conflate onto
      // the github.com project sharing the same "owner/repo" slug. GitLab filters
      // by webUrl host below; GitHub has no host column, so reject up front.
      if (input.host && input.host.toLowerCase() !== 'github.com') {
        return { matches: [] };
      }
      const rows = await this.githubRepo.find({
        where: { fullName: input.slug, projectId: Not(IsNull()) },
        relations: ['integration'],
        take: RESOLVE_MATCHES_LIMIT,
      });
      return {
        matches: rows.map((row) => ({
          projectId: row.projectId,
          organizationId: row.integration?.organizationId ?? '',
          provider: 'github',
          repositoryFullName: row.fullName,
        })),
      };
    }

    if (input.provider === 'gitlab') {
      // Unlike GitHub (whose table only holds github.com App repos), the
      // gitlab_repositories table can hold self-hosted instances, and
      // "group/sub/proj" paths are NOT globally unique across instances. An
      // empty host means "the public gitlab.com" (per the DTO contract), so we
      // ALWAYS filter by webUrl host — defaulting to gitlab.com when omitted —
      // to avoid conflating a public-gitlab.com repo with a self-hosted GitLab
      // project sharing the same path. This mirrors the GitHub-Enterprise guard.
      const host = input.host || 'gitlab.com';
      const where: FindOptionsWhere<GitlabRepository> = {
        pathWithNamespace: input.slug,
        projectId: Not(IsNull()),
        webUrl: Like(`%${escapeLikeWildcards(host)}%`),
      };
      const rows = await this.gitlabRepo.find({
        where,
        relations: ['integration'],
        take: RESOLVE_MATCHES_LIMIT,
      });
      return {
        matches: rows.map((row) => ({
          projectId: row.projectId,
          organizationId: row.integration?.organizationId ?? '',
          provider: 'gitlab',
          repositoryFullName: row.pathWithNamespace,
        })),
      };
    }

    throw new RpcException({
      message: `Unsupported provider '${input.provider}' (expected 'github' or 'gitlab')`,
      code: GrpcStatus.INVALID_ARGUMENT,
    });
  }
}
