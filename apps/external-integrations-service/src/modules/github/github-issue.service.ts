import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { Logger } from 'nestjs-pino';

// Create Octokit with retry and throttling plugins
const OctokitWithPlugins = Octokit.plugin(retry, throttling);
import { Span } from 'nestjs-otel';

import { GithubRepository } from '../../entities/github-repository.entity';
import { GithubIntegration } from '../../entities/github-integration.entity';
import {
  VulnerabilityIssueMapping,
  IssuePlatform,
} from '../../entities/vulnerability-issue-mapping.entity';
import { IssueDescriptionService } from '../issue/issue-description.service';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../../edition/ports/entitlements.port';

import {
  CreateGithubIssuesRequest,
  CreateGithubIssuesResponse,
  CloseGithubIssueRequest,
  CloseGithubIssueResponse,
  GetGithubProjectIssuesRequest,
  GetGithubProjectIssuesResponse,
  UpdateGithubIssueRequest,
  UpdateGithubIssueResponse,
  IssueCreationMode,
  IssueInfo,
  VulnerabilityInfo,
} from '@grpc/external-integrations/issue';

/**
 * Service for managing GitHub issues linked to CybeDefend vulnerabilities.
 */
@Injectable()
export class GithubIssueService {
  private readonly githubAppId: string;
  private readonly githubPrivateKey: string;

  constructor(
    @InjectRepository(GithubRepository)
    private readonly githubRepoRepository: Repository<GithubRepository>,
    @InjectRepository(GithubIntegration)
    private readonly githubIntegrationRepository: Repository<GithubIntegration>,
    @InjectRepository(VulnerabilityIssueMapping)
    private readonly issueMappingRepository: Repository<VulnerabilityIssueMapping>,
    private readonly issueDescriptionService: IssueDescriptionService,
    private readonly configService: ConfigService,
    private readonly logger: Logger,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: EntitlementsPort,
  ) {
    this.githubAppId = this.configService.get<string>('GITHUB_APP_ID', '');
    this.githubPrivateKey = this.configService.get<string>(
      'GITHUB_PRIVATE_KEY',
      '',
    );
  }

  /**
   * True when a GitHub App is configured (a positive integer app id
   * and a non-empty private key); the instance boots either way.
   */
  isGithubAppConfigured(): boolean {
    const appId = Number(this.githubAppId);
    return (
      this.githubAppId.trim() !== '' &&
      Number.isInteger(appId) &&
      appId > 0 &&
      this.githubPrivateKey.length > 0
    );
  }

  private assertGithubAppConfigured(): void {
    if (!this.isGithubAppConfigured()) {
      throw new RpcException({
        message: 'GITHUB_APP_NOT_CONFIGURED',
        code: status.FAILED_PRECONDITION,
      });
    }
  }

  /**
   * Create an authenticated Octokit instance for a specific installation.
   */
  private async getOctokitForInstallation(
    installationId: number,
  ): Promise<Octokit> {
    this.assertGithubAppConfigured();
    const auth = createAppAuth({
      appId: this.githubAppId,
      privateKey: this.githubPrivateKey,
      installationId,
    });

    const { token } = await auth({ type: 'installation' });
    return new OctokitWithPlugins({
      auth: token,
      request: {
        timeout: 30000,
      },
      retry: {
        enabled: true,
        retries: 3,
        doNotRetry: [400, 401, 403, 404, 422],
      },
      throttle: {
        onRateLimit: (retryAfter, options, octokit, retryCount) => {
          this.logger.warn(
            `Rate limit hit for ${(options as { method: string; url: string }).method} ${(options as { method: string; url: string }).url}, retrying after ${retryAfter}s (attempt ${retryCount + 1})`,
          );
          return retryCount < 3;
        },
        onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
          this.logger.warn(
            `Secondary rate limit hit for ${(options as { method: string; url: string }).method} ${(options as { method: string; url: string }).url}`,
          );
          return retryCount < 1;
        },
      },
    });
  }

  /**
   * Create issues for vulnerabilities detected in a project.
   */
  @Span()
  async createIssues(
    request: CreateGithubIssuesRequest,
  ): Promise<CreateGithubIssuesResponse> {
    const { projectId, organizationId, scanId, mode, vulnerabilities } =
      request;

    // Issue creation requires a writable organization.
    await this.entitlements.assertWritable(organizationId);

    this.logger.log(
      `Creating GitHub issues for project ${projectId}, mode: ${mode}, vulnerabilities: ${vulnerabilities.length}`,
    );

    // Find the GitHub repository linked to this project
    const githubRepo = await this.githubRepoRepository.findOne({
      where: { projectId },
      relations: ['integration'],
    });

    if (!githubRepo) {
      return {
        success: false,
        message: 'No GitHub repository linked to this project',
        issues: [],
        failedVulnerabilityIds: vulnerabilities.map((v) => v.vulnerabilityId),
      };
    }

    const integration = githubRepo.integration;
    if (!integration) {
      return {
        success: false,
        message: 'GitHub integration not found for this repository',
        issues: [],
        failedVulnerabilityIds: vulnerabilities.map((v) => v.vulnerabilityId),
      };
    }

    try {
      const octokit = await this.getOctokitForInstallation(
        integration.installationId,
      );

      const [owner, repo] = githubRepo.fullName.split('/');
      const createdIssues: IssueInfo[] = [];
      const failedVulnerabilityIds: string[] = [];

      // Group vulnerabilities based on mode
      const groupedVulnerabilities = this.groupVulnerabilities(
        vulnerabilities,
        mode,
      );

      for (const [groupKey, groupVulns] of groupedVulnerabilities) {
        // Check if an issue already exists for this group
        const existingMapping = await this.findExistingIssueMapping(
          projectId,
          groupVulns,
          mode,
          groupKey,
        );

        if (existingMapping) {
          // Verify the issue is still open on GitHub
          const isStillOpen = await this.verifyIssueIsOpen(
            octokit,
            owner,
            repo,
            parseInt(existingMapping.externalIssueId, 10),
          );

          if (isStillOpen) {
            this.logger.log(
              `[GitHub] Skipping issue creation - issue already exists and is open for group '${groupKey}': #${existingMapping.externalIssueId}`,
            );
            continue;
          }

          // Issue was closed on GitHub, update our mapping and create a new one
          this.logger.log(
            `Issue #${existingMapping.externalIssueId} was closed on GitHub, creating new issue for group ${groupKey}`,
          );
          await this.issueMappingRepository.update(
            { id: existingMapping.id },
            { issueState: 'closed' },
          );
        }

        try {
          const issueContent = this.generateIssueContent(
            groupVulns,
            mode,
            groupKey,
          );

          // Create issue with retry and rate limit handling
          const githubIssue = await this.createIssueWithRetry(
            octokit,
            owner,
            repo,
            issueContent.title,
            issueContent.body,
            this.getLabelsForVulnerabilities(groupVulns),
          );

          // Save mappings for all vulnerabilities in this issue
          for (const vuln of groupVulns) {
            await this.issueMappingRepository.save({
              projectId,
              vulnerabilityId: vuln.vulnerabilityId,
              scannerType: vuln.scannerType,
              platform: IssuePlatform.GITHUB,
              externalIssueId: githubIssue.number.toString(),
              issueUrl: githubIssue.html_url,
              issueTitle: this.truncateTitle(githubIssue.title),
              issueState: githubIssue.state,
              repositoryId: githubRepo.id,
              scanId,
              groupKey:
                mode === IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY
                  ? null
                  : this.truncateTitle(groupKey),
              creationMode: this.modeToString(mode),
            });
          }

          createdIssues.push({
            issueId: githubIssue.id.toString(),
            issueNumber: githubIssue.number,
            title: githubIssue.title,
            url: githubIssue.html_url,
            state: githubIssue.state,
            vulnerabilityIds: groupVulns.map((v) => v.vulnerabilityId),
            createdAt: githubIssue.created_at,
            updatedAt: githubIssue.updated_at,
          });

          this.logger.log(
            `Created GitHub issue #${githubIssue.number} for ${groupVulns.length} vulnerabilities`,
          );

          // Add delay between issue creations to avoid rate limits
          // GitHub allows ~30 requests/minute for content creation
          await this.delay(2000);
        } catch (error) {
          this.logger.error(
            `Failed to create issue for group ${groupKey}: ${error.message}`,
          );
          failedVulnerabilityIds.push(
            ...groupVulns.map((v) => v.vulnerabilityId),
          );
        }
      }

      return {
        success: createdIssues.length > 0,
        message: `Created ${createdIssues.length} issues`,
        issues: createdIssues,
        failedVulnerabilityIds,
      };
    } catch (error) {
      this.logger.error(`Failed to create GitHub issues: ${error.message}`);
      return {
        success: false,
        message: error.message,
        issues: [],
        failedVulnerabilityIds: vulnerabilities.map((v) => v.vulnerabilityId),
      };
    }
  }

  /**
   * Close an issue when vulnerabilities are resolved.
   */
  @Span()
  async closeIssue(
    request: CloseGithubIssueRequest,
  ): Promise<CloseGithubIssueResponse> {
    const { projectId, issueNumber, reason, vulnerabilityIds } = request;

    const githubRepo = await this.githubRepoRepository.findOne({
      where: { projectId },
      relations: ['integration'],
    });

    if (!githubRepo || !githubRepo.integration) {
      return {
        success: false,
        message: 'GitHub repository or integration not found',
        issue: undefined,
      };
    }

    try {
      const octokit = await this.getOctokitForInstallation(
        githubRepo.integration.installationId,
      );
      const [owner, repo] = githubRepo.fullName.split('/');

      // Try to add a closing comment (non-blocking - issue will still be closed if this fails)
      const closingComment =
        this.issueDescriptionService.generateClosingComment(
          reason,
          vulnerabilityIds.length,
        );

      try {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: closingComment,
        });
      } catch (commentError) {
        this.logger.warn(
          `[GitHub] Could not add closing comment to issue #${issueNumber}: ${commentError.message}. Proceeding to close the issue anyway.`,
        );
      }

      // Close the issue
      const { data: githubIssue } = await octokit.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        state: 'closed',
        state_reason: reason === 'false_positive' ? 'not_planned' : 'completed',
      });

      // Update mappings
      await this.issueMappingRepository.update(
        {
          projectId,
          externalIssueId: issueNumber.toString(),
          platform: IssuePlatform.GITHUB,
        },
        { issueState: 'closed' },
      );

      return {
        success: true,
        message: `Issue #${issueNumber} closed`,
        issue: {
          issueId: githubIssue.id.toString(),
          issueNumber: githubIssue.number,
          title: githubIssue.title,
          url: githubIssue.html_url,
          state: githubIssue.state,
          vulnerabilityIds,
          createdAt: githubIssue.created_at,
          updatedAt: githubIssue.updated_at,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to close GitHub issue: ${error.message}`);
      return {
        success: false,
        message: error.message,
        issue: undefined,
      };
    }
  }

  /**
   * Get existing issues for a project.
   */
  @Span()
  async getProjectIssues(
    request: GetGithubProjectIssuesRequest,
  ): Promise<GetGithubProjectIssuesResponse> {
    const { projectId, state, vulnerabilityIds } = request;

    const queryBuilder = this.issueMappingRepository
      .createQueryBuilder('mapping')
      .where('mapping.projectId = :projectId', { projectId })
      .andWhere('mapping.platform = :platform', {
        platform: IssuePlatform.GITHUB,
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

    // Group by issue
    const issueMap = new Map<string, IssueInfo>();
    for (const mapping of mappings) {
      const existing = issueMap.get(mapping.externalIssueId);
      if (existing) {
        existing.vulnerabilityIds.push(mapping.vulnerabilityId);
      } else {
        issueMap.set(mapping.externalIssueId, {
          issueId: mapping.id,
          issueNumber: parseInt(mapping.externalIssueId, 10),
          title: mapping.issueTitle,
          url: mapping.issueUrl || '',
          state: mapping.issueState,
          vulnerabilityIds: [mapping.vulnerabilityId],
          createdAt: mapping.createdAt.toISOString(),
          updatedAt: mapping.updatedAt.toISOString(),
        });
      }
    }

    return {
      success: true,
      issues: Array.from(issueMap.values()),
    };
  }

  /**
   * Update an issue (add comment, update labels, update body/title).
   */
  @Span()
  async updateIssue(
    request: UpdateGithubIssueRequest,
  ): Promise<UpdateGithubIssueResponse> {
    const {
      projectId,
      issueNumber,
      comment,
      addLabels,
      removeLabels,
      body,
      title,
      remainingVulnerabilities,
      mode,
      groupKey,
    } = request;

    const githubRepo = await this.githubRepoRepository.findOne({
      where: { projectId },
      relations: ['integration'],
    });

    if (!githubRepo || !githubRepo.integration) {
      return {
        success: false,
        message: 'GitHub repository or integration not found',
        issue: undefined,
      };
    }

    try {
      const octokit = await this.getOctokitForInstallation(
        githubRepo.integration.installationId,
      );
      const [owner, repo] = githubRepo.fullName.split('/');

      // Add comment if provided
      if (comment) {
        try {
          await octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body: comment,
          });
        } catch (commentError: any) {
          this.logger.warn(
            `[GitHub] Could not add comment to issue #${issueNumber}: ${commentError.message}. Continuing with other updates.`,
          );
        }
      }

      // Update issue body/title if provided or regenerate from remaining vulnerabilities
      let newBody = body;
      let newTitle = title;

      if (
        remainingVulnerabilities &&
        remainingVulnerabilities.length > 0 &&
        mode !== undefined
      ) {
        // Regenerate body from remaining vulnerabilities
        const issueContent = this.generateIssueContent(
          remainingVulnerabilities,
          mode,
          groupKey || remainingVulnerabilities[0]?.name || 'Unknown',
        );
        newBody = issueContent.body;
        newTitle = issueContent.title;
      }

      if (newBody || newTitle) {
        const updateParams: any = {
          owner,
          repo,
          issue_number: issueNumber,
        };
        if (newBody) updateParams.body = newBody;
        if (newTitle) updateParams.title = newTitle;

        await octokit.issues.update(updateParams);
        this.logger.log(
          `[GitHub] Updated issue #${issueNumber} ${newTitle ? 'title' : ''} ${newBody ? 'body' : ''}`,
        );
      }

      // Get current labels
      const { data: issue } = await octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });

      let currentLabels = issue.labels
        .map((l) => (typeof l === 'string' ? l : l.name))
        .filter((l): l is string => !!l);

      // Add new labels
      if (addLabels && addLabels.length > 0) {
        currentLabels = [...new Set([...currentLabels, ...addLabels])];
      }

      // Remove labels
      if (removeLabels && removeLabels.length > 0) {
        currentLabels = currentLabels.filter((l) => !removeLabels.includes(l));
      }

      // Update labels if changed
      if (addLabels?.length || removeLabels?.length) {
        await octokit.issues.setLabels({
          owner,
          repo,
          issue_number: issueNumber,
          labels: currentLabels,
        });
      }

      const { data: updatedIssue } = await octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });

      return {
        success: true,
        message: 'Issue updated successfully',
        issue: {
          issueId: updatedIssue.id.toString(),
          issueNumber: updatedIssue.number,
          title: updatedIssue.title,
          url: updatedIssue.html_url,
          state: updatedIssue.state || 'open',
          vulnerabilityIds: [],
          createdAt: updatedIssue.created_at,
          updatedAt: updatedIssue.updated_at,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to update GitHub issue: ${error.message}`);
      return {
        success: false,
        message: error.message,
        issue: undefined,
      };
    }
  }

  /**
   * Close issues for resolved vulnerabilities (batch operation).
   */
  @Span()
  async closeIssuesForVulnerabilities(
    projectId: string,
    vulnerabilityIds: string[],
    reason: string,
  ): Promise<void> {
    // Find all issue mappings for these vulnerabilities
    const mappings = await this.issueMappingRepository.find({
      where: {
        projectId,
        platform: IssuePlatform.GITHUB,
      },
    });

    // Group by issue number to check if all vulnerabilities in an issue are resolved
    const issueVulnMap = new Map<string, string[]>();
    for (const mapping of mappings) {
      const existing = issueVulnMap.get(mapping.externalIssueId) || [];
      existing.push(mapping.vulnerabilityId);
      issueVulnMap.set(mapping.externalIssueId, existing);
    }

    // Find issues where all vulnerabilities are now resolved
    const issuesToClose: string[] = [];
    for (const [issueId, issueVulns] of issueVulnMap) {
      if (issueVulns.every((vid) => vulnerabilityIds.includes(vid))) {
        issuesToClose.push(issueId);
      }
    }

    // Close issues
    for (const issueNumber of issuesToClose) {
      try {
        const vulnsInIssue = issueVulnMap.get(issueNumber) || [];
        await this.closeIssue({
          projectId,
          organizationId: '',
          issueNumber: parseInt(issueNumber, 10),
          reason,
          vulnerabilityIds: vulnsInIssue,
        });
      } catch (error) {
        this.logger.error(
          `Failed to close issue #${issueNumber}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Group vulnerabilities based on creation mode.
   */
  private groupVulnerabilities(
    vulnerabilities: VulnerabilityInfo[],
    mode: IssueCreationMode,
  ): Map<string, VulnerabilityInfo[]> {
    const groups = new Map<string, VulnerabilityInfo[]>();

    // Normalize mode - gRPC may send as number OR as string name
    const normalizedMode = this.normalizeMode(mode);

    this.logger.log(
      `Grouping ${vulnerabilities.length} vulnerabilities with mode: ${normalizedMode} (raw: ${mode}, type: ${typeof mode})`,
    );

    for (const vuln of vulnerabilities) {
      let key: string;

      if (normalizedMode === 'per_vulnerability') {
        // Each vulnerability DETECTION gets its own issue
        // Create a unique key combining vulnerability ID with location info
        key = this.getUniqueDetectionKey(vuln);
      } else if (normalizedMode === 'per_vulnerability_type') {
        // Group by vulnerability ID (CVE/GHSA) or rule ID - prefer short identifiers
        key =
          vuln.externalId ||
          this.getShortName(vuln.name) ||
          vuln.vulnerabilityId;
      } else if (normalizedMode === 'per_file') {
        // Group by file path and scanner type
        if (vuln.scannerType?.toLowerCase() === 'sca') {
          key = `SCA:${vuln.filePath || 'dependencies'}`;
        } else {
          key = `${vuln.scannerType || 'SAST'}:${vuln.filePath || 'unknown'}`;
        }
      } else {
        // Default: group by vulnerability type
        key =
          vuln.externalId ||
          this.getShortName(vuln.name) ||
          vuln.vulnerabilityId;
      }

      const existing = groups.get(key) || [];
      existing.push(vuln);
      groups.set(key, existing);
    }

    // Log grouping results
    this.logger.log(
      `Grouped into ${groups.size} groups. Group sizes: ${Array.from(
        groups.entries(),
      )
        .map(([k, v]) => `"${k}": ${v.length}`)
        .join(', ')}`,
    );

    return groups;
  }

  /**
   * Find existing issue mapping for a group of vulnerabilities.
   */
  private async findExistingIssueMapping(
    projectId: string,
    vulnerabilities: VulnerabilityInfo[],
    mode: IssueCreationMode,
    groupKey: string,
  ): Promise<VulnerabilityIssueMapping | null> {
    // For all modes, check by groupKey which is now unique per detection/group
    // In per_vulnerability mode, groupKey = getUniqueDetectionKey()
    // In per_vulnerability_type mode, groupKey = CVE/rule ID
    // In per_file mode, groupKey = scannerType:filePath
    // Only look for OPEN issues to avoid creating duplicates
    return this.issueMappingRepository.findOne({
      where: {
        projectId,
        groupKey: this.truncateTitle(groupKey),
        platform: IssuePlatform.GITHUB,
        creationMode: this.modeToString(mode),
        issueState: 'open', // GitHub uses 'open'
      },
    });
  }

  /**
   * Generate issue title and body based on mode.
   */
  private generateIssueContent(
    vulnerabilities: VulnerabilityInfo[],
    mode: IssueCreationMode,
    groupKey: string,
  ): { title: string; body: string } {
    switch (mode) {
      case IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY:
        return this.issueDescriptionService.generateSingleVulnerabilityIssue(
          vulnerabilities[0],
        );
      case IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE:
        return this.issueDescriptionService.generateVulnerabilityTypeIssue(
          vulnerabilities,
          groupKey,
        );
      case IssueCreationMode.ISSUE_CREATION_MODE_PER_FILE:
        return this.issueDescriptionService.generateFileIssue(
          vulnerabilities,
          groupKey,
        );
      default:
        return this.issueDescriptionService.generateVulnerabilityTypeIssue(
          vulnerabilities,
          groupKey,
        );
    }
  }

  /**
   * Get appropriate labels for vulnerabilities.
   */
  private getLabelsForVulnerabilities(
    vulnerabilities: VulnerabilityInfo[],
  ): string[] {
    const labels = new Set<string>(['security', 'cybedefend']);

    // Add severity labels
    const severities = new Set(
      vulnerabilities.map((v) => v.severity.toLowerCase()),
    );
    for (const severity of severities) {
      if (['critical', 'high', 'medium', 'low'].includes(severity)) {
        labels.add(`severity:${severity}`);
      }
    }

    // Add scanner type labels
    const scannerTypes = new Set(vulnerabilities.map((v) => v.scannerType));
    for (const scannerType of scannerTypes) {
      labels.add(scannerType);
    }

    return Array.from(labels);
  }

  /**
   * Normalize mode to a consistent string value.
   * Handles both numeric enum values and string names from gRPC.
   */
  private normalizeMode(mode: IssueCreationMode | string | number): string {
    // If it's a string name like "ISSUE_CREATION_MODE_PER_VULNERABILITY"
    if (typeof mode === 'string') {
      const modeStr = mode.toString().toUpperCase();
      if (modeStr.includes('PER_VULNERABILITY_TYPE')) {
        return 'per_vulnerability_type';
      }
      if (modeStr.includes('PER_FILE')) {
        return 'per_file';
      }
      if (modeStr.includes('PER_VULNERABILITY')) {
        return 'per_vulnerability';
      }
      // Try to parse as number
      const num = parseInt(mode, 10);
      if (!isNaN(num)) {
        return this.modeNumToString(num);
      }
      return 'per_vulnerability_type'; // default
    }
    // If it's a number
    return this.modeNumToString(Number(mode));
  }

  /**
   * Convert numeric mode to string.
   */
  private modeNumToString(mode: number): string {
    switch (mode) {
      case IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY:
        return 'per_vulnerability';
      case IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY_TYPE:
        return 'per_vulnerability_type';
      case IssueCreationMode.ISSUE_CREATION_MODE_PER_FILE:
        return 'per_file';
      default:
        return 'per_vulnerability_type';
    }
  }

  /**
   * Convert mode enum to string.
   */
  private modeToString(mode: IssueCreationMode): string {
    return this.normalizeMode(mode);
  }

  /**
   * Truncate title to fit database column limit (255 characters).
   * Adds ellipsis if truncated.
   */
  private truncateTitle(title: string): string {
    const maxLength = 255;
    if (title.length <= maxLength) {
      return title;
    }
    return title.substring(0, maxLength - 3) + '...';
  }

  /**
   * Extract a short name from a potentially long vulnerability description.
   * Takes the first meaningful portion before common separators.
   */
  private getShortName(name: string | undefined): string | undefined {
    if (!name) return undefined;
    // If it looks like a CVE or short identifier, use as-is
    if (name.length <= 100) return name;
    // Extract first sentence or meaningful portion
    const firstSentence = name.split(/[.!?]\s/)[0];
    if (firstSentence && firstSentence.length <= 100) {
      return firstSentence;
    }
    // Truncate to first 80 chars with ellipsis
    return name.substring(0, 80) + '...';
  }

  /**
   * Generate a unique key for a vulnerability detection.
   * This ensures each individual detection gets its own issue in per_vulnerability mode.
   * For SCA: combines vulnerabilityId + packageName + packageVersion
   * For SAST/others: combines vulnerabilityId + filePath + startLine
   */
  private getUniqueDetectionKey(vuln: VulnerabilityInfo): string {
    if (vuln.scannerType?.toLowerCase() === 'sca') {
      // SCA: same CVE in different packages = different detections
      return `${vuln.vulnerabilityId}:${vuln.packageName || 'unknown'}@${vuln.packageVersion || 'unknown'}`;
    }
    // SAST/IAC/Secret/Container: same rule in different locations = different detections
    return `${vuln.vulnerabilityId}:${vuln.filePath || 'unknown'}:${vuln.startLine || 0}`;
  }

  /**
   * Create an issue with retry logic and rate limit handling.
   * Implements exponential backoff with long waits for GitHub's secondary rate limits.
   */
  private async createIssueWithRetry(
    octokit: Octokit,
    owner: string,
    repo: string,
    title: string,
    body: string,
    labels: string[],
    maxRetries = 5,
  ): Promise<{
    id: number;
    number: number;
    title: string;
    html_url: string;
    state: string;
    created_at: string;
    updated_at: string;
  }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const { data } = await octokit.issues.create({
          owner,
          repo,
          title,
          body,
          labels,
        });
        return data;
      } catch (error) {
        lastError = error;

        // Check if it's a rate limit error (403 with secondary rate limit message)
        const isRateLimitError =
          error.status === 403 &&
          (error.message?.includes('rate limit') ||
            error.message?.includes('secondary rate limit'));

        if (isRateLimitError && attempt < maxRetries - 1) {
          // Get Retry-After header if available, otherwise use exponential backoff
          // GitHub secondary rate limits typically require 60-120s wait
          const retryAfter = this.getRetryAfterMs(error);
          // Exponential backoff with much longer base: 30s, 60s, 120s, 240s...
          const exponentialBackoff = Math.pow(2, attempt) * 30000;
          const backoffMs = retryAfter || exponentialBackoff;

          this.logger.warn(
            `Rate limited, waiting ${Math.round(backoffMs / 1000)}s before retry ${attempt + 2}/${maxRetries}`,
          );
          await this.delay(backoffMs);
          continue;
        }

        // For non-rate-limit errors or final retry, throw immediately
        throw error;
      }
    }

    throw lastError || new Error('Failed to create issue after retries');
  }

  /**
   * Extract Retry-After value from GitHub error response.
   * Returns milliseconds to wait, or null if not available.
   */
  private getRetryAfterMs(error: any): number | null {
    try {
      // Octokit stores headers in response.headers
      const retryAfter =
        error.response?.headers?.['retry-after'] ||
        error.response?.headers?.['x-ratelimit-reset'];

      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) {
          // If it's a unix timestamp, calculate difference
          if (seconds > 1000000000) {
            return Math.max(
              0,
              (seconds - Math.floor(Date.now() / 1000)) * 1000,
            );
          }
          // Otherwise it's seconds to wait
          return seconds * 1000;
        }
      }
    } catch {
      // Ignore parsing errors
    }
    return null;
  }

  /**
   * Delay helper for rate limiting.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Verify if an issue is still open on GitHub.
   * Returns true if open, false if closed or not found.
   */
  private async verifyIssueIsOpen(
    octokit: Octokit,
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<boolean> {
    try {
      const { data: issue } = await octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });
      return issue.state === 'open';
    } catch (error) {
      // If we can't fetch the issue (deleted, permissions, etc.), treat as closed
      this.logger.warn(
        `Could not verify issue #${issueNumber} state: ${error.message}`,
      );
      return false;
    }
  }
}
