import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { SlackIntegration } from '../../entities/slack-integration.entity';
import {
  CONTAINER_REGISTRIES_ADMIN_PORT,
  type ContainerRegistriesAdminPort,
} from '../../edition/ports/container-registries-admin.port';

/**
 * Integration types accepted by IntegrationsAdminService.
 *
 * - "jira"               -> JiraIntegration
 * - "linear"             -> LinearIntegration (its project mappings go with it
 *                           through the foreign key, ON DELETE CASCADE)
 * - "github_issues"      -> GithubIntegration
 * - "gitlab_issues"      -> GitlabIntegration
 * - "slack"              -> SlackIntegration
 * - "container_registry" -> the closed registry integrations, through
 *                           CONTAINER_REGISTRIES_ADMIN_PORT (src/ee in cloud,
 *                           no-op in the Community Edition)
 *
 * Despite their names, "github_issues" and "gitlab_issues" are the GitHub App
 * installation and the GitLab connection themselves: deleting them cascades to
 * every repository and project link. Only an organization's deletion (and the
 * orphan cleanup) may pass them; a caller that merely disables issue creation
 * must not.
 */
type IntegrationType =
  | 'jira'
  | 'linear'
  | 'github_issues'
  | 'gitlab_issues'
  | 'slack'
  | 'container_registry';

/**
 * Org-wide count and bulk-delete operations across the integration entities
 * exposed by external-integrations-service. Used by billing-service plan
 * transitions when downgrading to a plan that disables an integration type.
 *
 * The container registry integrations are cloud-only: nothing here names them
 * beyond the type string, and their repositories are reached only through
 * CONTAINER_REGISTRIES_ADMIN_PORT.
 */
@Injectable()
export class IntegrationsAdminService {
  constructor(
    private readonly logger: Logger,
    @InjectRepository(JiraIntegration)
    private readonly jiraRepo: Repository<JiraIntegration>,
    @InjectRepository(LinearIntegration)
    private readonly linearRepo: Repository<LinearIntegration>,
    @InjectRepository(GithubIntegration)
    private readonly githubRepo: Repository<GithubIntegration>,
    @InjectRepository(GitlabIntegration)
    private readonly gitlabRepo: Repository<GitlabIntegration>,
    @InjectRepository(SlackIntegration)
    private readonly slackRepo: Repository<SlackIntegration>,
    @Inject(CONTAINER_REGISTRIES_ADMIN_PORT)
    private readonly containerRegistries: ContainerRegistriesAdminPort,
  ) {}

  /**
   * Repositories grouped by integration type. "container_registry" is not
   * here: it goes through the admin port, so the closed repos stay out of
   * the core.
   */
  private repos(type: string): Array<Repository<any>> {
    switch (type as IntegrationType) {
      case 'jira':
        return [this.jiraRepo];
      case 'linear':
        return [this.linearRepo];
      case 'github_issues':
        return [this.githubRepo];
      case 'gitlab_issues':
        return [this.gitlabRepo];
      case 'slack':
        return [this.slackRepo];
      default:
        return [];
    }
  }

  /**
   * Every integration type this service knows how to count and delete.
   */
  static readonly ALL_TYPES: readonly IntegrationType[] = [
    'jira',
    'linear',
    'github_issues',
    'gitlab_issues',
    'slack',
    'container_registry',
  ];

  /**
   * Distinct organization ids that own at least one integration row, across
   * every integration table. Used by the orphan-cleanup script to diff against
   * the organizations that still exist in global-management: integration
   * tables live in a separate database with no FK to `organizations`, so an
   * organization deleted before that cleanup was wired in leaves rows behind
   * that no product path can ever remove.
   *
   * DISTINCT is done by the database, not in memory: the result is bounded by
   * the number of organizations. The container registry credential tables are
   * reached through CONTAINER_REGISTRIES_ADMIN_PORT (fail-soft per table
   * there, as here).
   *
   * Fail-soft per table: a failing query is logged and the scan continues, so
   * a partial result is still actionable.
   */
  async listOrganizationIdsWithIntegrations(): Promise<string[]> {
    const organizationIds = new Set<string>();
    for (const type of IntegrationsAdminService.ALL_TYPES) {
      if (type === 'container_registry') {
        try {
          for (const id of await this.containerRegistries.listOrganizationIds()) {
            organizationIds.add(id);
          }
        } catch (e) {
          this.logger.error(
            { err: (e as Error).message, type },
            'listOrganizationIdsWithIntegrations sub-query failed (fail-soft)',
          );
        }
        continue;
      }
      for (const repo of this.repos(type)) {
        try {
          const rows = await repo
            .createQueryBuilder('integration')
            .select('DISTINCT integration.organizationId', 'organizationId')
            .getRawMany<{ organizationId: string | null }>();
          for (const row of rows) {
            if (row.organizationId) {
              organizationIds.add(row.organizationId);
            }
          }
        } catch (e) {
          this.logger.error(
            { err: (e as Error).message, type },
            'listOrganizationIdsWithIntegrations sub-query failed (fail-soft)',
          );
        }
      }
    }
    return [...organizationIds];
  }

  /**
   * Count integrations of a given type belonging to the organization.
   * Returns 0 for unknown types (deletion preview shows nothing).
   */
  async countIntegrationsForOrg(
    organizationId: string,
    type: string,
  ): Promise<number> {
    if (type === 'container_registry') {
      try {
        return await this.containerRegistries.countForOrg(organizationId);
      } catch (e) {
        this.logger.warn(
          { err: (e as Error).message, organizationId, type },
          'countIntegrationsForOrg sub-query failed',
        );
        return 0;
      }
    }
    const repos = this.repos(type);
    if (repos.length === 0) {
      return 0;
    }
    let total = 0;
    for (const repo of repos) {
      try {
        total += await repo.count({ where: { organizationId } });
      } catch (e) {
        this.logger.warn(
          { err: (e as Error).message, organizationId, type },
          'countIntegrationsForOrg sub-query failed',
        );
      }
    }
    return total;
  }

  /**
   * Delete integrations for the organization. Iterates the requested types
   * fail-soft: a failure on one type is logged and we continue with the rest.
   * Returns a per-type count of rows deleted.
   *
   * `failClosed` (the organization purge, data-purge module) throws the first
   * failure instead: a purge must not answer "complete" over rows a failed
   * delete left behind. Billing's plan transitions keep fail-soft.
   */
  async deleteIntegrationsForOrg(
    organizationId: string,
    types: readonly string[],
    options: { failClosed?: boolean } = {},
  ): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const type of types) {
      if (type === 'container_registry') {
        try {
          result[type] = await this.containerRegistries.deleteForOrg(
            organizationId,
            { failClosed: options.failClosed },
          );
        } catch (e) {
          if (options.failClosed) throw e;
          this.logger.error(
            { err: (e as Error).message, organizationId, type },
            'deleteIntegrationsForOrg sub-query failed (fail-soft)',
          );
          result[type] = 0;
        }
        this.logger.log(
          { organizationId, type, deleted: result[type] },
          'deleteIntegrationsForOrg type complete',
        );
        continue;
      }
      const repos = this.repos(type);
      if (repos.length === 0) {
        result[type] = 0;
        continue;
      }
      let typeTotal = 0;
      for (const repo of repos) {
        try {
          const r = await repo.delete({ organizationId });
          typeTotal += r.affected ?? 0;
        } catch (e) {
          if (options.failClosed) throw e;
          this.logger.error(
            { err: (e as Error).message, organizationId, type },
            'deleteIntegrationsForOrg sub-query failed (fail-soft)',
          );
        }
      }
      this.logger.log(
        { organizationId, type, deleted: typeTotal },
        'deleteIntegrationsForOrg type complete',
      );
      result[type] = typeTotal;
    }
    return result;
  }
}
