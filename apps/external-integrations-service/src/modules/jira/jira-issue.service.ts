import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { isUniqueViolation } from '@cybedefend/db-dialect';

import {
  VulnerabilityIssueMapping,
  IssuePlatform,
} from '../../entities/vulnerability-issue-mapping.entity';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { JiraProjectMapping } from '../../entities/jira-project-mapping.entity';
import { JiraService } from './jira.service';
import { JiraDescriptionService } from './jira-description.service';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../../edition/ports/entitlements.port';
import {
  buildCybeDefendGroupUrl,
  groupVulnerabilities,
  normalizeIssueCreationMode,
  vulnerabilityDisplayName,
} from '../issue/issue-grouping';

import {
  CreateJiraIssuesRequest,
  CreateJiraIssuesResponse,
  LinkJiraIssueRequest,
  LinkJiraIssueResponse,
  GetJiraProjectIssuesRequest,
  GetJiraProjectIssuesResponse,
  GetJiraIssueStatusRequest,
  GetJiraIssueStatusResponse,
  IssueCreationMode,
  IssueInfo,
  VulnerabilityInfo,
} from '@grpc/external-integrations/issue';

@Injectable()
export class JiraIssueService {
  constructor(
    @InjectRepository(VulnerabilityIssueMapping)
    private readonly issueMappingRepository: Repository<VulnerabilityIssueMapping>,
    @InjectRepository(JiraProjectMapping)
    private readonly projectMappingRepo: Repository<JiraProjectMapping>,
    private readonly jiraService: JiraService,
    private readonly descriptionService: JiraDescriptionService,
    private readonly logger: Logger,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: EntitlementsPort,
  ) {}

  /**
   * Create Jira issues for vulnerabilities detected in a project.
   */
  @Span()
  async createIssues(
    request: CreateJiraIssuesRequest,
  ): Promise<CreateJiraIssuesResponse> {
    const {
      projectId,
      organizationId,
      scanId,
      mode,
      cybedefendBaseUrl,
      jiraProjectKey,
    } = request;
    let { vulnerabilities } = request;

    // Gate Jira ticket creation behind the organization's writability.
    // Throws RpcException(PERMISSION_DENIED, "WRITES_BLOCKED") when blocked.
    await this.entitlements.assertWritable(organizationId);

    this.logger.log(
      `Creating Jira issues for project ${projectId}, mode: ${mode}, vulnerabilities: ${vulnerabilities.length}`,
    );

    // Get Jira integration for this org
    const integration =
      await this.jiraService.getIntegrationForOrga(organizationId);

    // Determine target Jira project key and load config
    let targetProjectKey = jiraProjectKey;
    const mapping = await this.projectMappingRepo.findOne({
      where: { projectId },
    });
    if (!targetProjectKey && mapping) {
      targetProjectKey = mapping.jiraProjectKey;
    }

    // Enforce branch restriction server-side (US 1.3)
    if (mapping?.allowedBranches) {
      let allowedBranches: string[] = [];
      try {
        allowedBranches = JSON.parse(mapping.allowedBranches);
      } catch {
        allowedBranches = [];
      }
      if (allowedBranches.length > 0) {
        const branches = new Set(allowedBranches);
        const disallowed = vulnerabilities.filter(
          (v) => v.branch && !branches.has(v.branch),
        );
        if (disallowed.length === vulnerabilities.length) {
          return {
            success: false,
            message: `Branch restriction: none of the vulnerabilities are on allowed branches (${allowedBranches.join(', ')})`,
            issues: [],
            failedVulnerabilityIds: vulnerabilities.map(
              (v) => v.vulnerabilityId,
            ),
          };
        }
        // Filter out vulnerabilities on disallowed branches
        if (disallowed.length > 0) {
          this.logger.warn(
            `Filtered ${disallowed.length} vulnerabilities on disallowed branches`,
          );
          vulnerabilities = vulnerabilities.filter(
            (v) => !v.branch || branches.has(v.branch),
          );
        }
      }
    }

    if (!targetProjectKey) {
      return {
        success: false,
        message:
          'No Jira project configured. Please set a default Jira project in project settings.',
        issues: [],
        failedVulnerabilityIds: vulnerabilities.map((v) => v.vulnerabilityId),
      };
    }

    const createdIssues: IssueInfo[] = [];
    const failedVulnerabilityIds: string[] = [];

    // Group vulnerabilities based on mode
    const groupedVulnerabilities = groupVulnerabilities(vulnerabilities, mode);

    for (const [groupKey, groupVulns] of groupedVulnerabilities) {
      // Check for existing open issue by group key to avoid duplicates
      const existingMapping = await this.findExistingIssueMapping(
        projectId,
        mode,
        groupKey,
      );

      if (existingMapping) {
        this.logger.log(
          `Skipping issue creation - issue already exists for group '${groupKey}': ${existingMapping.externalIssueId}`,
        );
        continue;
      }

      // Also check if any individual vulnerability already has a non-terminal Jira ticket
      const vulnIds = groupVulns.map((v) => v.vulnerabilityId);
      const existingVulnMappings = await this.issueMappingRepository.find({
        where: {
          projectId,
          platform: IssuePlatform.JIRA,
          issueState: Not(In(['done', 'closed', 'resolved', 'deleted'])),
          vulnerabilityId: In(vulnIds),
        },
      });

      if (existingVulnMappings.length > 0) {
        const existingKeys = [
          ...new Set(existingVulnMappings.map((m) => m.externalIssueId)),
        ];
        this.logger.log(
          `Skipping issue creation - ${existingVulnMappings.length} vulnerabilities already linked to Jira tickets: ${existingKeys.join(', ')}`,
        );
        continue;
      }

      try {
        // Build issue content in ADF format
        const summary = this.buildSummary(groupVulns, mode, groupKey);
        const description = this.buildDescription(
          groupVulns,
          mode,
          groupKey,
          cybedefendBaseUrl,
          projectId,
        );
        const priority = this.descriptionService.mapSeverityToPriority(
          this.getHighestSeverity(groupVulns),
        );

        // Create issue via Jira API
        const jiraIssue = await this.createIssueWithRetry(
          integration,
          targetProjectKey,
          summary,
          description,
          priority,
        );

        const issueKey = jiraIssue.key as string;
        const issueId = jiraIssue.id as string;
        const issueUrl = `${integration.siteUrl}/browse/${issueKey}`;

        // Save mappings for all vulnerabilities in this issue
        for (const vuln of groupVulns) {
          try {
            await this.issueMappingRepository.save({
              projectId,
              vulnerabilityId: vuln.vulnerabilityId,
              scannerType: vuln.scannerType,
              platform: IssuePlatform.JIRA,
              externalIssueId: issueKey,
              issueUrl,
              issueTitle: this.truncate(summary, 255),
              issueState: 'open',
              jiraProjectKey: targetProjectKey,
              jiraPriority: priority.name,
              scanId,
              groupKey:
                mode === IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY
                  ? null
                  : this.truncate(groupKey, 255),
              creationMode: this.modeToString(mode),
            });
          } catch (saveError) {
            if (isUniqueViolation(saveError)) {
              this.logger.log(
                `Skipping duplicate mapping for vulnerability ${vuln.vulnerabilityId}`,
              );
            } else {
              throw saveError;
            }
          }
        }

        createdIssues.push({
          issueId,
          issueNumber: 0, // Jira uses keys, not numbers
          title: summary,
          url: issueUrl,
          state: 'open',
          vulnerabilityIds: groupVulns.map((v) => v.vulnerabilityId),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        this.logger.log(
          `Created Jira issue ${issueKey} for ${groupVulns.length} vulnerabilities`,
        );

        // Rate limit: wait between creations
        await this.delay(1000);
      } catch (error) {
        this.logger.error(
          `Failed to create Jira issue for group ${groupKey}: ${error.message}`,
        );
        failedVulnerabilityIds.push(
          ...groupVulns.map((v) => v.vulnerabilityId),
        );
      }
    }

    return {
      success: createdIssues.length > 0,
      message: `Created ${createdIssues.length} Jira issues`,
      issues: createdIssues,
      failedVulnerabilityIds,
    };
  }

  /**
   * Link vulnerabilities to an existing Jira issue (DB-only, no Jira modification).
   * Per US 2.2: does NOT overwrite the Jira description.
   */
  @Span()
  async linkExistingIssue(
    request: LinkJiraIssueRequest,
  ): Promise<LinkJiraIssueResponse> {
    const {
      projectId,
      organizationId,
      jiraIssueKey,
      vulnerabilityIds,
      scannerType,
      vulnerabilities,
      cybedefendBaseUrl,
    } = request;

    // Validate the Jira issue exists
    const integration =
      await this.jiraService.getIntegrationForOrga(organizationId);

    const issueData = await this.jiraService.jiraApiCall(
      integration,
      'GET',
      `/issue/${jiraIssueKey}?fields=summary,status,description`,
    );

    const issueKey = (issueData.key as string) || jiraIssueKey;
    const fields = issueData.fields as Record<string, unknown>;
    const summary = (fields?.summary as string) || '';
    const statusObj = fields?.status as Record<string, unknown>;
    const issueState = (statusObj?.name as string)?.toLowerCase() || 'open';
    const issueUrl = `${integration.siteUrl}/browse/${issueKey}`;

    // Save mappings (idempotent: update existing, create new)
    for (const vulnId of vulnerabilityIds) {
      const existing = await this.issueMappingRepository.findOne({
        where: {
          projectId,
          vulnerabilityId: vulnId,
          platform: IssuePlatform.JIRA,
          externalIssueId: issueKey,
        },
      });

      if (existing) {
        // Update existing mapping
        existing.issueState = issueState;
        existing.issueTitle = this.truncate(summary, 255);
        await this.issueMappingRepository.save(existing);
      } else {
        await this.issueMappingRepository.save({
          projectId,
          vulnerabilityId: vulnId,
          scannerType,
          platform: IssuePlatform.JIRA,
          externalIssueId: issueKey,
          issueUrl,
          issueTitle: this.truncate(summary, 255),
          issueState,
          creationMode: 'linked',
        });
      }
    }

    // Append linked-vulnerabilities section to the existing Jira description
    this.logger.log(
      `Linking ${vulnerabilityIds.length} vulns to ${issueKey}, received ${vulnerabilities?.length ?? 0} vulnerability details`,
    );
    try {
      const existingDescription = fields?.description as
        | Record<string, unknown>
        | null
        | undefined;
      // Build CybeDefend link to the grouped vulnerability view
      const vulnType = scannerType?.toLowerCase() || 'sast';
      const vulnName = vulnerabilities?.[0]?.name || '';
      const cybedefendUrl =
        cybedefendBaseUrl && projectId
          ? `${cybedefendBaseUrl}/project/${projectId}/${vulnType}?search=${encodeURIComponent(vulnName)}`
          : '';
      const newNodes =
        this.descriptionService.buildLinkedVulnerabilitiesSection(
          vulnerabilityIds.length,
          scannerType,
          vulnerabilities,
          cybedefendUrl,
        );
      const updatedDescription = this.descriptionService.appendToDescription(
        existingDescription,
        newNodes,
      );
      await this.jiraService.jiraApiCall(
        integration,
        'PUT',
        `/issue/${issueKey}`,
        {
          fields: { description: updatedDescription },
        },
      );
      this.logger.log(`Appended linked-vulnerabilities section to ${issueKey}`);
    } catch (err) {
      this.logger.warn(
        `Could not update Jira description for ${issueKey}: ${(err as Error).message}`,
      );
    }

    return {
      success: true,
      message: `Linked ${vulnerabilityIds.length} vulnerabilities to ${issueKey}`,
      issue: {
        issueId: issueData.id as string,
        issueNumber: 0,
        title: summary,
        url: issueUrl,
        state: issueState,
        vulnerabilityIds,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Get existing Jira issues for a project.
   */
  @Span()
  async getProjectIssues(
    request: GetJiraProjectIssuesRequest,
  ): Promise<GetJiraProjectIssuesResponse> {
    const { projectId, state, vulnerabilityIds } = request;

    const queryBuilder = this.issueMappingRepository
      .createQueryBuilder('mapping')
      .where('mapping.projectId = :projectId', { projectId })
      .andWhere('mapping.platform = :platform', {
        platform: IssuePlatform.JIRA,
      });

    if (state && state !== 'all') {
      queryBuilder.andWhere('mapping.issueState = :state', { state });
    }

    if (vulnerabilityIds && vulnerabilityIds.length > 0) {
      queryBuilder.andWhere('mapping.vulnerabilityId IN (:...vulnIds)', {
        vulnIds: vulnerabilityIds,
      });
    }

    const mappings = await queryBuilder.getMany();

    // Group by issue key
    const issueMap = new Map<string, IssueInfo>();
    for (const mapping of mappings) {
      const existing = issueMap.get(mapping.externalIssueId);
      if (existing) {
        existing.vulnerabilityIds.push(mapping.vulnerabilityId);
      } else {
        issueMap.set(mapping.externalIssueId, {
          issueId: mapping.id,
          issueNumber: 0,
          title: mapping.issueTitle,
          url: mapping.issueUrl || '',
          state: mapping.issueState,
          vulnerabilityIds: [mapping.vulnerabilityId],
          createdAt: mapping.createdAt.toISOString(),
          updatedAt: mapping.updatedAt.toISOString(),
          jiraProjectKey: mapping.jiraProjectKey || '',
          jiraPriority: mapping.jiraPriority || '',
          jiraAssignee: mapping.jiraAssignee || '',
        });
      }
    }

    // Status/assignee/priority are kept up-to-date via Jira webhooks.
    // No need to batch refresh here — data comes from DB cache.

    return {
      success: true,
      issues: Array.from(issueMap.values()),
    };
  }

  /**
   * Sync issue statuses from Jira.
   * Handles key changes when tickets are moved between Jira projects (US 4.1).
   */
  @Span()
  async getIssueStatus(
    request: GetJiraIssueStatusRequest,
  ): Promise<GetJiraIssueStatusResponse> {
    const { projectId, organizationId, externalIssueKeys } = request;

    const integration =
      await this.jiraService.getIntegrationForOrga(organizationId);

    const statuses: Array<{
      issueKey: string;
      status: string;
      statusCategory: string;
      issueUrl: string;
      hasPullRequest: boolean;
    }> = [];

    // An issue key is unique only within one Jira site, and a mapping row
    // carries no integration id: its issueUrl (`<site>/browse/<key>`) records
    // the site it was created on. A sync therefore writes only the rows of the
    // organization's own site, by id, so a row created on another site is
    // never re-keyed, re-pointed or re-stated with this integration.
    const ownSitePrefixes = this.browsePrefixes(integration.siteUrl);

    for (const issueKey of externalIssueKeys) {
      try {
        const candidates = await this.issueMappingRepository.find({
          where: {
            projectId,
            externalIssueId: issueKey,
            platform: IssuePlatform.JIRA,
          },
        });
        const ownIds = (candidates ?? [])
          .filter((mapping) =>
            ownSitePrefixes.some((prefix) =>
              (mapping.issueUrl ?? '').startsWith(prefix),
            ),
          )
          .map((mapping) => mapping.id);
        if (ownIds.length === 0) continue;

        const issueData = await this.jiraService.jiraApiCall(
          integration,
          'GET',
          `/issue/${issueKey}?fields=status,key`,
        );

        const fields = issueData.fields as Record<string, unknown>;
        const statusObj = fields?.status as Record<string, unknown>;
        const statusCategory = statusObj?.statusCategory as Record<
          string,
          unknown
        >;
        const currentKey = (issueData.key as string) || issueKey;
        const statusName = (statusObj?.name as string) || 'Unknown';
        const categoryKey = (statusCategory?.key as string) || 'new';

        // Update mapping if key changed (ticket moved between projects)
        if (currentKey !== issueKey) {
          await this.issueMappingRepository.update(
            { id: In(ownIds) },
            {
              externalIssueId: currentKey,
              issueUrl: `${integration.siteUrl}/browse/${currentKey}`,
            },
          );
          this.logger.log(
            `Jira issue key changed: ${issueKey} -> ${currentKey}`,
          );
        }

        // Update issue state in mapping
        await this.issueMappingRepository.update(
          { id: In(ownIds) },
          { issueState: statusName.toLowerCase() },
        );

        // Check for linked PRs via Dev Status API
        let hasPullRequest = false;
        try {
          const devInfo = await this.jiraService.jiraDevStatusCall(
            integration,
            'GET',
            `/issue/detail?issueId=${issueData.id}&applicationType=stash&dataType=pullrequest`,
          );
          const detail = (devInfo.detail || []) as Array<{
            pullRequests?: unknown[];
            branches?: unknown[];
          }>;
          hasPullRequest = detail.some(
            (d) => d.pullRequests?.length > 0 || d.branches?.length > 0,
          );
        } catch {
          // Dev-status API may not be available — silently default to false
        }

        statuses.push({
          issueKey: currentKey,
          status: statusName,
          statusCategory: categoryKey,
          issueUrl: `${integration.siteUrl}/browse/${currentKey}`,
          hasPullRequest,
        });
      } catch (error) {
        this.logger.warn(
          `Could not fetch status for Jira issue ${issueKey}: ${error.message}`,
        );
      }
    }

    return { success: true, statuses };
  }

  // ========== Private Helpers ==========

  /**
   * The issueUrl prefixes of tickets created on this site. Mapping URLs are
   * built as `${siteUrl}/browse/<key>`, so both the stored form and the form
   * without a trailing slash are accepted. No site, no prefix: nothing matches.
   */
  private browsePrefixes(siteUrl: string | null | undefined): string[] {
    if (!siteUrl) return [];
    const trimmed = siteUrl.replace(/\/+$/, '');
    if (!trimmed) return [];
    return [...new Set([`${siteUrl}/browse/`, `${trimmed}/browse/`])];
  }

  private async findExistingIssueMapping(
    projectId: string,
    mode: IssueCreationMode,
    groupKey: string,
  ): Promise<VulnerabilityIssueMapping | null> {
    return this.issueMappingRepository.findOne({
      where: {
        projectId,
        groupKey: this.truncate(groupKey, 255),
        platform: IssuePlatform.JIRA,
        creationMode: this.modeToString(mode),
        issueState: Not(In(['done', 'closed', 'resolved', 'deleted'])),
      },
    });
  }

  private buildSummary(
    vulnerabilities: VulnerabilityInfo[],
    mode: IssueCreationMode,
    groupKey: string,
  ): string {
    const normalizedMode = normalizeIssueCreationMode(mode);
    const readableName = vulnerabilityDisplayName(vulnerabilities[0]);

    if (normalizedMode === 'per_vulnerability') {
      return this.descriptionService.buildIssueSummary(readableName);
    }
    if (normalizedMode === 'per_file') {
      return this.descriptionService.buildIssueSummary(
        `${vulnerabilities.length} vulnerabilities in ${groupKey}`,
      );
    }
    // per_vulnerability_type
    return this.descriptionService.buildIssueSummary(
      `${readableName} (${vulnerabilities.length} occurrence${vulnerabilities.length > 1 ? 's' : ''})`,
    );
  }

  private buildDescription(
    vulnerabilities: VulnerabilityInfo[],
    mode: IssueCreationMode,
    groupKey: string,
    cybedefendBaseUrl: string,
    projectId?: string,
  ): Record<string, unknown> {
    const normalizedMode = normalizeIssueCreationMode(mode);

    // Build a direct link to the grouped view with search filter
    const vuln = vulnerabilities[0];
    const vulnName = vulnerabilityDisplayName(vuln);
    const directUrl =
      projectId && vuln?.scannerType
        ? buildCybeDefendGroupUrl(
            cybedefendBaseUrl,
            projectId,
            vuln.scannerType,
            vuln.name || vulnName,
          )
        : cybedefendBaseUrl;

    if (
      normalizedMode === 'per_vulnerability' &&
      vulnerabilities.length === 1
    ) {
      return this.descriptionService.buildSingleVulnerabilityDescription(
        vulnerabilities[0],
        directUrl,
      );
    }

    return this.descriptionService.buildGroupedVulnerabilityDescription(
      vulnerabilities,
      groupKey,
      directUrl,
    );
  }

  private getHighestSeverity(vulnerabilities: VulnerabilityInfo[]): string {
    const order = ['critical', 'high', 'medium', 'low', 'info'];
    for (const level of order) {
      if (vulnerabilities.some((v) => v.severity?.toLowerCase() === level)) {
        return level;
      }
    }
    return 'medium';
  }

  private async resolveIssueType(
    integration: JiraIntegration,
    projectKey: string,
  ): Promise<string> {
    try {
      const meta = await this.jiraService.jiraApiCall(
        integration,
        'GET',
        `/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`,
      );
      const projects = (meta.projects || []) as Array<{
        issuetypes?: Array<{ name: string; subtask?: boolean }>;
      }>;
      const issueTypes = projects[0]?.issuetypes || [];
      // Prefer Bug, then Task, then first non-subtask type
      const preferred = ['Bug', 'Task', 'Story'];
      for (const name of preferred) {
        if (issueTypes.some((t) => t.name === name && !t.subtask)) {
          return name;
        }
      }
      const firstNonSubtask = issueTypes.find((t) => !t.subtask);
      return firstNonSubtask?.name || 'Task';
    } catch {
      return 'Task';
    }
  }

  private async createIssueWithRetry(
    integration: JiraIntegration,
    projectKey: string,
    summary: string,
    description: Record<string, unknown>,
    priority: { id: string; name: string },
    maxRetries = 3,
  ): Promise<Record<string, unknown>> {
    let lastError: Error | null = null;

    const issueTypeName = await this.resolveIssueType(integration, projectKey);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.jiraService.jiraApiCall(
          integration,
          'POST',
          '/issue',
          {
            fields: {
              project: { key: projectKey },
              summary,
              description,
              issuetype: { name: issueTypeName },
              priority: { name: priority.name },
            },
          },
        );
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          const backoffMs = Math.pow(2, attempt) * 2000;
          this.logger.warn(
            `Jira issue creation failed, retrying in ${backoffMs / 1000}s (attempt ${attempt + 2}/${maxRetries})`,
          );
          await this.delay(backoffMs);
        }
      }
    }

    throw lastError || new Error('Failed to create Jira issue after retries');
  }

  private modeToString(mode: IssueCreationMode): string {
    return normalizeIssueCreationMode(mode);
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
