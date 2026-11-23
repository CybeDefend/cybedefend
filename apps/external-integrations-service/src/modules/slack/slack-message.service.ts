import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  communityAppUrl,
  publicAppUrl,
} from '../../core/config/public-app-url';
import { isCommunityEdition } from '../../edition/edition';

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<Record<string, unknown>>;
  fields?: Array<{ type: string; text: string }>;
  accessory?: Record<string, unknown>;
}

interface SlackAttachment {
  color: string;
  blocks: SlackBlock[];
}

export interface SlackMessagePayload {
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
}

@Injectable()
export class SlackMessageService {
  private readonly logger = new Logger(SlackMessageService.name);
  // Community: the instance URL (http://localhost:8080 when unset or not an
  // http(s) URL), never a cloud host. Cloud: undefined when neither
  // FRONTEND_URL nor APP_PUBLIC_URL is set, and the message then carries no
  // link button at all.
  private readonly appUrl: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.appUrl = isCommunityEdition()
      ? communityAppUrl(configService, this.logger)
      : publicAppUrl(configService);
  }

  buildMessage(
    notificationType: string,
    payload: Record<string, unknown>,
  ): SlackMessagePayload {
    switch (notificationType) {
      case 'zero_day_alert':
        return this.buildZeroDayAlert(payload);
      case 'weekly_report':
        return this.buildWeeklyReport(payload);
      case 'monthly_report':
        return this.buildMonthlyReport(payload);
      case 'scan_complete':
        return this.buildScanComplete(payload);
      default:
        return this.buildGenericMessage(payload);
    }
  }

  getFallbackText(
    notificationType: string,
    payload: Record<string, unknown>,
  ): string {
    const projectName = (payload.projectName as string) || 'Unknown project';
    switch (notificationType) {
      case 'zero_day_alert':
        return `Zero-day alert for ${projectName}: ${payload.count} new vulnerabilities detected`;
      case 'weekly_report':
        return `Weekly security report for ${projectName}`;
      case 'monthly_report':
        return `Monthly security report for ${projectName}`;
      case 'scan_complete':
        return `Scan completed for ${projectName}: ${payload.total} vulnerabilities found`;
      default:
        return `CybeDefend notification for ${projectName}`;
    }
  }

  private getProjectUrl(projectId: string): string | undefined {
    return this.appUrl ? `${this.appUrl}/project/${projectId}` : undefined;
  }

  // ========== Scan Complete ==========

  private buildScanComplete(
    payload: Record<string, unknown>,
  ): SlackMessagePayload {
    const projectName = (payload.projectName as string) || 'Unknown';
    const projectId = payload.projectId as string;
    const total = (payload.total as number) || 0;
    const scannerType = (payload.scannerType as string) || '';
    const branch = (payload.branch as string) || '';
    const severities = (payload.severities as Record<string, number>) || {};
    const types = (payload.types as Record<string, number>) || {};

    const critical = severities.critical || 0;
    const high = severities.high || 0;
    const medium = severities.medium || 0;
    const low = severities.low || 0;

    // Pick color based on highest severity found
    const color = this.getAttachmentColor(critical, high, medium, low);

    // Build scanner labels
    const scannerLabels = scannerType
      ? scannerType
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .join(' · ')
      : '';

    // Build context line: branch + scanners
    const contextParts: string[] = [];
    if (branch) {
      contextParts.push(`\`${branch}\``);
    }
    if (scannerLabels) {
      contextParts.push(scannerLabels);
    }

    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:white_check_mark:  *Scan Complete*`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${projectName}*${contextParts.length ? '  —  ' + contextParts.join('  ·  ') : ''}`,
        },
      },
    ];

    if (total > 0) {
      // Compact severity on one line with colored circle emojis
      const severityParts = [
        critical > 0 ? `:red_circle: *${critical}* critical` : null,
        high > 0 ? `:large_orange_circle: *${high}* high` : null,
        medium > 0 ? `:large_yellow_circle: *${medium}* medium` : null,
        low > 0 ? `:large_blue_circle: *${low}* low` : null,
      ].filter(Boolean);

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${total}* ${total === 1 ? 'vulnerability' : 'vulnerabilities'} found`,
        },
      });

      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: severityParts.join('  ·  '),
          },
        ],
      });

      // Type breakdown
      const activeTypes = Object.entries(types).filter(
        ([, count]) => count > 0,
      );
      if (activeTypes.length > 1) {
        const typeParts = activeTypes.map(
          ([type, count]) => `${type.toUpperCase()}: ${count}`,
        );
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: typeParts.join('  ·  '),
            },
          ],
        });
      }
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':white_check_mark: No vulnerabilities found',
        },
      });
    }

    const projectUrl = this.getProjectUrl(projectId);
    if (projectUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Results', emoji: true },
            url: branch
              ? `${projectUrl}/sast?branch=${encodeURIComponent(branch)}`
              : `${projectUrl}/sast`,
          },
        ],
      });
    }

    return {
      attachments: [{ color, blocks }],
    };
  }

  // ========== Zero-Day Alert ==========

  private buildZeroDayAlert(
    payload: Record<string, unknown>,
  ): SlackMessagePayload {
    const projectName = (payload.projectName as string) || 'Unknown';
    const projectId = payload.projectId as string;
    const count = (payload.count as number) || 0;
    const vulnerabilities =
      (payload.vulnerabilities as Array<Record<string, unknown>>) || [];

    // Collect distinct branches affected so the alert header tells the user
    // which branch view to open in the dashboard.
    const affectedBranches = Array.from(
      new Set(
        vulnerabilities
          .map((v) => v.branch as string | undefined)
          .filter((b): b is string => Boolean(b)),
      ),
    ).sort();

    const headerText = `:rotating_light:  *Zero-Day Vulnerability Alert*\n*${count} new ${count === 1 ? 'vulnerability' : 'vulnerabilities'}* detected in *${projectName}*`;

    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: headerText,
        },
      },
    ];

    if (affectedBranches.length > 0) {
      const branchList = affectedBranches.map((b) => `\`${b}\``).join('  ·  ');
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*Branch${affectedBranches.length === 1 ? '' : 'es'}:*  ${branchList}`,
          },
        ],
      });
    }

    blocks.push({ type: 'divider' });

    for (const vuln of vulnerabilities.slice(0, 5)) {
      const severity = ((vuln.severity as string) || 'unknown').toUpperCase();
      const severityEmoji = this.getSeverityEmoji(severity);
      const cvssText = vuln.cvss ? `  ·  CVSS ${vuln.cvss}` : '';
      const packageName = (vuln.packageName as string) || '';
      const version = (vuln.version as string) || '';
      const branch = (vuln.branch as string) || '';
      const pkgLine =
        packageName && version
          ? `\n\`${packageName}@${version}\``
          : packageName
            ? `\n\`${packageName}\``
            : '';
      const branchLine = branch ? `  ·  branch \`${branch}\`` : '';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${severityEmoji}  *${vuln.title || vuln.id}*\n${severity}${cvssText}${pkgLine}${branchLine}`,
        },
      });
    }

    if (vulnerabilities.length > 5) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_+ ${vulnerabilities.length - 5} more vulnerabilities_`,
          },
        ],
      });
    }

    // Deep-link to the first affected branch so the dashboard query matches.
    const branchQuery =
      affectedBranches.length > 0
        ? `?branch=${encodeURIComponent(affectedBranches[0])}`
        : '';

    const projectUrl = this.getProjectUrl(projectId);
    if (projectUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Details', emoji: true },
            url: `${projectUrl}/sca${branchQuery}`,
            style: 'danger',
          },
        ],
      });
    }

    return {
      attachments: [{ color: '#e01e5a', blocks }],
    };
  }

  // ========== Reports ==========

  private buildWeeklyReport(
    payload: Record<string, unknown>,
  ): SlackMessagePayload {
    return this.buildReportBlocks('Weekly', payload);
  }

  private buildMonthlyReport(
    payload: Record<string, unknown>,
  ): SlackMessagePayload {
    return this.buildReportBlocks('Monthly', payload);
  }

  private buildReportBlocks(
    period: string,
    payload: Record<string, unknown>,
  ): SlackMessagePayload {
    const projectName = (payload.projectName as string) || 'Unknown';
    const projectId = payload.projectId as string;
    const severities = (payload.severities as Record<string, number>) || {};
    const total = (payload.total as number) || 0;

    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:bar_chart:  *${period} Security Report*\n*${projectName}* — ${total} open ${total === 1 ? 'vulnerability' : 'vulnerabilities'}`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `:red_circle: Critical: *${severities.critical || 0}*`,
          },
          {
            type: 'mrkdwn',
            text: `:large_orange_circle: High: *${severities.high || 0}*`,
          },
          {
            type: 'mrkdwn',
            text: `:large_yellow_circle: Medium: *${severities.medium || 0}*`,
          },
          {
            type: 'mrkdwn',
            text: `:large_blue_circle: Low: *${severities.low || 0}*`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*New:* ${payload.newCount || 0}  |  *Resolved:* ${payload.resolvedCount || 0}`,
          },
        ],
      },
    ];

    const projectUrl = this.getProjectUrl(projectId);
    if (projectUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Report', emoji: true },
            url: `${projectUrl}/reports`,
            style: 'primary',
          },
        ],
      });
    }

    return {
      attachments: [{ color: '#4a90d9', blocks }],
    };
  }

  // ========== Generic ==========

  private buildGenericMessage(
    payload: Record<string, unknown>,
  ): SlackMessagePayload {
    return {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: (payload.message as string) || 'CybeDefend notification',
          },
        },
      ],
    };
  }

  // ========== Helpers ==========

  private getSeverityEmoji(severity: string): string {
    switch (severity.toLowerCase()) {
      case 'critical':
        return ':red_circle:';
      case 'high':
        return ':large_orange_circle:';
      case 'medium':
        return ':large_yellow_circle:';
      case 'low':
        return ':large_blue_circle:';
      default:
        return ':white_circle:';
    }
  }

  private getAttachmentColor(
    critical: number,
    high: number,
    medium: number,
    low: number,
  ): string {
    if (critical > 0) return '#e01e5a'; // Red
    if (high > 0) return '#f2952f'; // Orange
    if (medium > 0) return '#ecb22e'; // Yellow
    if (low > 0) return '#4a90d9'; // Blue
    return '#2eb67d'; // Green — no vulns
  }
}
