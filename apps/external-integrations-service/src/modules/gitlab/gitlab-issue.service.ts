import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Logger } from 'nestjs-pino';
import { Span } from 'nestjs-otel';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import {
  VulnerabilityIssueMapping,
  IssuePlatform,
} from '../../entities/vulnerability-issue-mapping.entity';
import { IssueDescriptionService } from '../issue/issue-description.service';
import SecretsService from '../../core/secrets/secrets.service';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../../edition/ports/entitlements.port';

import {
  CreateGitlabIssuesRequest,
  CreateGitlabIssuesResponse,
  CloseGitlabIssueRequest,
  CloseGitlabIssueResponse,
  GetGitlabProjectIssuesRequest,
  GetGitlabProjectIssuesResponse,
  UpdateGitlabIssueRequest,
  UpdateGitlabIssueResponse,
  IssueCreationMode,
  IssueInfo,
  VulnerabilityInfo,
} from '@grpc/external-integrations/issue';

import { flagReconnectRequired, isRevokedGrant } from './gitlab-reconnect';
import { gitlabUrls, GitlabUrls } from './gitlab-urls';

const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * Service for managing GitLab issues linked to CybeDefend vulnerabilities.
 */
@Injectable()
export class GitlabIssueService implements OnModuleInit {
  private readonly urls: GitlabUrls;
  private readonly gitlabApiUrl: string;
  private gitlabClientId: string;
  private gitlabClientSecret: string;
  private encryptionKey: string;

  constructor(
    @InjectRepository(GitlabRepository)
    private readonly gitlabRepoRepository: Repository<GitlabRepository>,
    @InjectRepository(GitlabIntegration)
    private readonly gitlabIntegrationRepository: Repository<GitlabIntegration>,
    @InjectRepository(VulnerabilityIssueMapping)
    private readonly issueMappingRepository: Repository<VulnerabilityIssueMapping>,
    private readonly issueDescriptionService: IssueDescriptionService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
    private readonly logger: Logger,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: EntitlementsPort,
  ) {
    // Every GitLab URL derives from GITLAB_API_URL (default gitlab.com).
    this.urls = gitlabUrls(this.configService.get<string>('GITLAB_API_URL'));
    this.gitlabApiUrl = this.urls.api;
  }

  async onModuleInit() {
    this.gitlabClientId = await this.secretsService.getSecret(
      'GITLAB_APPLICATION_ID',
    );
    this.gitlabClientSecret = await this.secretsService.getSecret(
      'GITLAB_APPLICATION_SECRET',
    );
    this.encryptionKey = await this.secretsService.getSecret(
      'GITLAB_ENCRYPTION_KEY',
    );
  }

  /**
   * Decrypt a token encrypted with AES-256-GCM.
   * Format: "iv:authTag:encryptedData" in hex encoding.
   */
  private decryptToken(encryptedToken: string): string | null {
    if (!encryptedToken || !this.encryptionKey) {
      return null;
    }

    try {
      const key = Buffer.from(this.encryptionKey, 'hex');
      const parts = encryptedToken.split(':');

      if (parts.length !== 3) {
        // Token might not be encrypted, return as-is
        return encryptedToken;
      }

      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = Buffer.from(parts[2], 'hex');

      if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
        this.logger.warn('Invalid auth tag length, token may not be encrypted');
        return encryptedToken;
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
        authTagLength: AUTH_TAG_LENGTH_BYTES,
      });

      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (error) {
      this.logger.error(`Failed to decrypt token: ${error.message}`);
      return null;
    }
  }

  /**
   * Encrypt a token using AES-256-GCM.
   * Output format: "iv:authTag:encryptedData" in hex encoding.
   */
  private encryptToken(token: string): string | null {
    if (!token || !this.encryptionKey) {
      return null;
    }

    try {
      const key = Buffer.from(this.encryptionKey, 'hex');
      const iv = crypto.randomBytes(16);

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
        authTagLength: AUTH_TAG_LENGTH_BYTES,
      });

      const encrypted = Buffer.concat([
        cipher.update(token, 'utf8'),
        cipher.final(),
      ]);

      const authTag = cipher.getAuthTag();

      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
    } catch (error) {
      this.logger.error(`Failed to encrypt token: ${error.message}`);
      return null;
    }
  }

  /**
   * Refresh the access token if needed.
   * Always fetches the latest integration from DB to avoid stale tokens.
   */
  private async refreshTokenIfNeeded(integrationId: string): Promise<string> {
    // Always fetch the latest integration from DB to get the most recent token
    const integration = await this.gitlabIntegrationRepository.findOne({
      where: { id: integrationId },
    });

    if (!integration) {
      throw new Error('GitLab integration not found');
    }

    // Check if token is about to expire (within 5 minutes)
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (
      integration.tokenExpiresAt &&
      new Date(integration.tokenExpiresAt) > fiveMinutesFromNow
    ) {
      // Token is still valid, decrypt and return it
      const decryptedToken = this.decryptToken(integration.accessToken);
      if (!decryptedToken) {
        throw new Error('Failed to decrypt access token');
      }
      return decryptedToken;
    }

    // Refresh the token
    if (!integration.refreshToken) {
      throw new Error('No refresh token available');
    }

    // Decrypt the refresh token before using it
    const decryptedRefreshToken = this.decryptToken(integration.refreshToken);
    if (!decryptedRefreshToken) {
      throw new Error('Failed to decrypt refresh token');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(this.urls.oauthToken, {
          client_id: this.gitlabClientId,
          client_secret: this.gitlabClientSecret,
          refresh_token: decryptedRefreshToken,
          grant_type: 'refresh_token',
        }),
      );

      const { access_token, refresh_token, expires_in } = response.data;

      // Encrypt the new tokens before saving
      const encryptedAccessToken = this.encryptToken(access_token);
      const encryptedRefreshToken = this.encryptToken(refresh_token);

      // Update integration with new encrypted tokens
      await this.gitlabIntegrationRepository.update(integration.id, {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: new Date(now.getTime() + expires_in * 1000),
        reconnectRequiredAt: null,
      });

      // Return the plain access token for immediate use
      return access_token;
    } catch (error) {
      // `integration.refreshToken` is the encrypted token just sent: the mark
      // only lands if no other process rotated it meanwhile.
      if (isRevokedGrant(error)) {
        await flagReconnectRequired(
          this.gitlabIntegrationRepository,
          this.logger,
          integration,
          integration.refreshToken,
        );
      }
      this.logger.error(`Failed to refresh GitLab token: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create issues for vulnerabilities detected in a project.
   */
  @Span()
  async createIssues(
    request: CreateGitlabIssuesRequest,
  ): Promise<CreateGitlabIssuesResponse> {
    const { projectId, organizationId, scanId, mode, vulnerabilities } =
      request;

    // Gate GitLab issue creation behind the organization's writability.
    await this.entitlements.assertWritable(organizationId);

    this.logger.log(
      `Creating GitLab issues for project ${projectId}, mode: ${mode}, vulnerabilities: ${vulnerabilities.length}`,
    );

    // Find the GitLab repository linked to this project
    const gitlabRepo = await this.gitlabRepoRepository.findOne({
      where: { projectId },
      relations: ['integration'],
    });

    if (!gitlabRepo) {
      return {
        success: false,
        message: 'No GitLab repository linked to this project',
        issues: [],
        failedVulnerabilityIds: vulnerabilities.map((v) => v.vulnerabilityId),
      };
    }

    const integration = gitlabRepo.integration;
    if (!integration) {
      return {
        success: false,
        message: 'GitLab integration not found for this repository',
        issues: [],
        failedVulnerabilityIds: vulnerabilities.map((v) => v.vulnerabilityId),
      };
    }

    try {
      const accessToken = await this.refreshTokenIfNeeded(integration.id);
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
          // Verify the issue is still open on GitLab
          const isStillOpen = await this.verifyIssueIsOpen(
            accessToken,
            gitlabRepo.gitlabId,
            parseInt(existingMapping.externalIssueId, 10),
          );

          if (isStillOpen) {
            this.logger.log(
              `[GitLab] Skipping issue creation - issue already exists and is open for group '${groupKey}': #${existingMapping.externalIssueId}`,
            );
            continue;
          }

          // Issue was closed on GitLab, update our mapping and create a new one
          this.logger.log(
            `Issue #${existingMapping.externalIssueId} was closed on GitLab, creating new issue for group ${groupKey}`,
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
          const gitlabIssue = await this.createIssueWithRetry(
            accessToken,
            gitlabRepo.gitlabId,
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
              platform: IssuePlatform.GITLAB,
              externalIssueId: gitlabIssue.iid.toString(),
              issueUrl: gitlabIssue.web_url,
              issueTitle: this.truncateTitle(gitlabIssue.title),
              issueState: gitlabIssue.state,
              repositoryId: gitlabRepo.id,
              scanId,
              groupKey:
                mode === IssueCreationMode.ISSUE_CREATION_MODE_PER_VULNERABILITY
                  ? null
                  : this.truncateTitle(groupKey),
              creationMode: this.modeToString(mode),
            });
          }

          createdIssues.push({
            issueId: gitlabIssue.id.toString(),
            issueNumber: gitlabIssue.iid,
            title: gitlabIssue.title,
            url: gitlabIssue.web_url,
            state: gitlabIssue.state,
            vulnerabilityIds: groupVulns.map((v) => v.vulnerabilityId),
            createdAt: gitlabIssue.created_at,
            updatedAt: gitlabIssue.updated_at,
          });

          this.logger.log(
            `Created GitLab issue #${gitlabIssue.iid} for ${groupVulns.length} vulnerabilities`,
          );

          // Add delay between issue creations to avoid rate limits
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
      this.logger.error(`Failed to create GitLab issues: ${error.message}`);
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
    request: CloseGitlabIssueRequest,
  ): Promise<CloseGitlabIssueResponse> {
    const { projectId, issueIid, reason, vulnerabilityIds } = request;

    const gitlabRepo = await this.gitlabRepoRepository.findOne({
      where: { projectId },
      relations: ['integration'],
    });

    if (!gitlabRepo || !gitlabRepo.integration) {
      return {
        success: false,
        message: 'GitLab repository or integration not found',
        issue: undefined,
      };
    }

    try {
      const accessToken = await this.refreshTokenIfNeeded(
        gitlabRepo.integration.id,
      );

      // Try to add a closing comment (non-blocking - issue will still be closed if this fails)
      const closingComment =
        this.issueDescriptionService.generateClosingComment(
          reason,
          vulnerabilityIds.length,
        );

      try {
        await firstValueFrom(
          this.httpService.post(
            `${this.gitlabApiUrl}/projects/${gitlabRepo.gitlabId}/issues/${issueIid}/notes`,
            { body: closingComment },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            },
          ),
        );
      } catch (commentError) {
        this.logger.warn(
          `[GitLab] Could not add closing comment to issue #${issueIid}: ${commentError.message}. Proceeding to close the issue anyway.`,
        );
      }

      // Close the issue
      const response = await firstValueFrom(
        this.httpService.put(
          `${this.gitlabApiUrl}/projects/${gitlabRepo.gitlabId}/issues/${issueIid}`,
          { state_event: 'close' },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const gitlabIssue = response.data;

      // Update mappings
      await this.issueMappingRepository.update(
        {
          projectId,
          externalIssueId: issueIid.toString(),
          platform: IssuePlatform.GITLAB,
        },
        { issueState: 'closed' },
      );

      return {
        success: true,
        message: `Issue #${issueIid} closed`,
        issue: {
          issueId: gitlabIssue.id.toString(),
          issueNumber: gitlabIssue.iid,
          title: gitlabIssue.title,
          url: gitlabIssue.web_url,
          state: gitlabIssue.state,
          vulnerabilityIds,
          createdAt: gitlabIssue.created_at,
          updatedAt: gitlabIssue.updated_at,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to close GitLab issue: ${error.message}`);
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
    request: GetGitlabProjectIssuesRequest,
  ): Promise<GetGitlabProjectIssuesResponse> {
    const { projectId, state, vulnerabilityIds } = request;

    const queryBuilder = this.issueMappingRepository
      .createQueryBuilder('mapping')
      .where('mapping.projectId = :projectId', { projectId })
      .andWhere('mapping.platform = :platform', {
        platform: IssuePlatform.GITLAB,
      });

    if (state && state !== 'all') {
      // Map GitLab state names
      const mappedState = state === 'open' ? 'opened' : state;
      queryBuilder.andWhere('mapping.issueState = :state', {
        state: mappedState,
      });
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
    request: UpdateGitlabIssueRequest,
  ): Promise<UpdateGitlabIssueResponse> {
    const {
      projectId,
      issueIid,
      comment,
      addLabels,
      removeLabels,
      body,
      title,
      remainingVulnerabilities,
      mode,
      groupKey,
    } = request;

    const gitlabRepo = await this.gitlabRepoRepository.findOne({
      where: { projectId },
      relations: ['integration'],
    });

    if (!gitlabRepo || !gitlabRepo.integration) {
      return {
        success: false,
        message: 'GitLab repository or integration not found',
        issue: undefined,
      };
    }

    try {
      const accessToken = await this.refreshTokenIfNeeded(
        gitlabRepo.integration.id,
      );

      // Add comment if provided
      if (comment) {
        try {
          await firstValueFrom(
            this.httpService.post(
              `${this.gitlabApiUrl}/projects/${gitlabRepo.gitlabId}/issues/${issueIid}/notes`,
              { body: comment },
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
              },
            ),
          );
        } catch (commentError: any) {
          this.logger.warn(
            `[GitLab] Could not add comment to issue #${issueIid}: ${commentError.message}. Continuing with other updates.`,
          );
        }
      }

      // Update issue body/title if provided or regenerate from remaining vulnerabilities
      let newDescription = body;
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
        newDescription = issueContent.body;
        newTitle = issueContent.title;
      }

      if (newDescription || newTitle) {
        const updateData: any = {};
        if (newDescription) updateData.description = newDescription;
        if (newTitle) updateData.title = newTitle;

        await firstValueFrom(
          this.httpService.put(
            `${this.gitlabApiUrl}/projects/${gitlabRepo.gitlabId}/issues/${issueIid}`,
            updateData,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            },
          ),
        );
        this.logger.log(
          `[GitLab] Updated issue #${issueIid} ${newTitle ? 'title' : ''} ${newDescription ? 'description' : ''}`,
        );
      }

      // Get current labels
      const issueResponse = await firstValueFrom(
        this.httpService.get(
          `${this.gitlabApiUrl}/projects/${gitlabRepo.gitlabId}/issues/${issueIid}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        ),
      );

      let currentLabels: string[] = issueResponse.data.labels || [];

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
        await firstValueFrom(
          this.httpService.put(
            `${this.gitlabApiUrl}/projects/${gitlabRepo.gitlabId}/issues/${issueIid}`,
            { labels: currentLabels.join(',') },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            },
          ),
        );
      }

      // Get updated issue
      const updatedResponse = await firstValueFrom(
        this.httpService.get(
          `${this.gitlabApiUrl}/projects/${gitlabRepo.gitlabId}/issues/${issueIid}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        ),
      );

      const gitlabIssue = updatedResponse.data;

      return {
        success: true,
        message: 'Issue updated successfully',
        issue: {
          issueId: gitlabIssue.id.toString(),
          issueNumber: gitlabIssue.iid,
          title: gitlabIssue.title,
          url: gitlabIssue.web_url,
          state: gitlabIssue.state,
          vulnerabilityIds: [],
          createdAt: gitlabIssue.created_at,
          updatedAt: gitlabIssue.updated_at,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to update GitLab issue: ${error.message}`);
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
        platform: IssuePlatform.GITLAB,
      },
    });

    // Group by issue IID to check if all vulnerabilities in an issue are resolved
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
    for (const issueIid of issuesToClose) {
      try {
        const vulnsInIssue = issueVulnMap.get(issueIid) || [];
        await this.closeIssue({
          projectId,
          organizationId: '',
          issueIid: parseInt(issueIid, 10),
          reason,
          vulnerabilityIds: vulnsInIssue,
        });
      } catch (error) {
        this.logger.error(
          `Failed to close GitLab issue #${issueIid}: ${error.message}`,
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
    const mapping = await this.issueMappingRepository.findOne({
      where: {
        projectId,
        groupKey: this.truncateTitle(groupKey),
        platform: IssuePlatform.GITLAB,
        creationMode: this.modeToString(mode),
        issueState: 'opened', // GitLab uses 'opened' not 'open'
      },
    });

    // Also check for 'open' state (in case of inconsistency)
    if (!mapping) {
      return this.issueMappingRepository.findOne({
        where: {
          projectId,
          groupKey: this.truncateTitle(groupKey),
          platform: IssuePlatform.GITLAB,
          creationMode: this.modeToString(mode),
          issueState: 'open',
        },
      });
    }

    return mapping;
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

    const severities = new Set(
      vulnerabilities.map((v) => v.severity.toLowerCase()),
    );
    for (const severity of severities) {
      if (['critical', 'high', 'medium', 'low'].includes(severity)) {
        labels.add(`severity::${severity}`);
      }
    }

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
   * Verify if an issue is still open on GitLab.
   * Returns true if open, false if closed or not found.
   */
  /**
   * Create an issue with retry logic and rate limit handling.
   * Implements exponential backoff with long waits for rate limits.
   */
  private async createIssueWithRetry(
    accessToken: string,
    gitlabProjectId: number,
    title: string,
    description: string,
    labels: string[],
    maxRetries = 5,
  ): Promise<{
    id: number;
    iid: number;
    title: string;
    web_url: string;
    state: string;
    created_at: string;
    updated_at: string;
  }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `${this.gitlabApiUrl}/projects/${gitlabProjectId}/issues`,
            {
              title,
              description,
              labels: labels.join(','),
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            },
          ),
        );
        return response.data;
      } catch (error) {
        lastError = error;

        // Check if it's a rate limit error (429 or 403)
        const status = error.response?.status || error.status;
        const isRateLimitError =
          status === 429 ||
          (status === 403 &&
            error.message?.toLowerCase().includes('rate limit'));

        if (isRateLimitError && attempt < maxRetries - 1) {
          // Get Retry-After header if available
          const retryAfter = this.getRetryAfterMs(error);
          // Exponential backoff with longer base: 30s, 60s, 120s...
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
   * Extract Retry-After value from error response.
   * Returns milliseconds to wait, or null if not available.
   */
  private getRetryAfterMs(error: any): number | null {
    try {
      const retryAfter =
        error.response?.headers?.['retry-after'] ||
        error.response?.headers?.['ratelimit-reset'];

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

  private async verifyIssueIsOpen(
    accessToken: string,
    gitlabProjectId: number,
    issueIid: number,
  ): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.gitlabApiUrl}/projects/${gitlabProjectId}/issues/${issueIid}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        ),
      );
      return response.data.state === 'opened';
    } catch (error) {
      // If we can't fetch the issue (deleted, permissions, etc.), treat as closed
      this.logger.warn(
        `Could not verify GitLab issue #${issueIid} state: ${error.message}`,
      );
      return false;
    }
  }
}
