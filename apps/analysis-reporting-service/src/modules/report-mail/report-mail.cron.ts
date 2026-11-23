import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import {
  ReportAggregationService,
  type AggregatedCicdVuln,
  type AggregatedSecretVuln,
} from './report-aggregation.service';
import { ClientGrpc } from '@nestjs/microservices';
import {
  MAIL_REPORT_SERVICE_NAME,
  MailReportServiceClient,
  ConsolidatedWeeklyReportRequest,
  ConsolidatedMonthlyReportRequest,
  ConsolidatedDailyCriticalReportRequest,
  WeeklyReportProjectItem,
  MonthlyReportProjectItem,
  DailyCriticalReportProjectItem,
  VulnerabilityItem,
} from '@grpc/global-management/mail';
import {
  ProjectServiceClient,
  PROJECT_SERVICE_NAME,
} from '@grpc/global-management/global_management';
import {
  SlackServiceClient,
  SLACK_SERVICE_NAME,
} from '@grpc/external-integrations/external_integrations';
import { SendSlackNotificationRequest } from '@grpc/external-integrations/slack';
import { Span } from 'nestjs-otel';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import {
  AnalysisReportingEntitlementsPort,
  ENTITLEMENTS_PORT,
} from 'src/edition/ports/entitlements.port';
import { readArchivedBranches } from 'src/core/utils/project-read.util';

// Internal strongly-typed aggregation contract (should mirror service aggregation output)
interface AggregatedVulnBase {
  id: string;
  severity: string;
  state: string;
  createdAt: string; // ISO
  branch?: string; // git branch the detection was scanned on (may be absent)
}
interface AggregatedSastVuln extends AggregatedVulnBase {
  type: 'SAST';
  title: string; // vulnerability.name
}
interface AggregatedIacVuln extends AggregatedVulnBase {
  type: 'IAC';
  title: string; // vulnerability.name
}
interface AggregatedScaVuln extends AggregatedVulnBase {
  type: 'SCA';
  title: string; // vulnerability.id or package
  packageName?: string;
  version?: string;
  cvss?: string; // from severities[0].score
}
interface AggregatedContainerVuln extends AggregatedVulnBase {
  type: 'CONTAINER';
  title: string; // identifier
  packageName?: string; // detectedPackage name
  version?: string; // fixed / installed version (if relevant)
  cvss?: string;
}

type AggregatedVuln =
  | AggregatedSastVuln
  | AggregatedIacVuln
  | AggregatedScaVuln
  | AggregatedContainerVuln
  | AggregatedSecretVuln
  | AggregatedCicdVuln;

interface DailyCriticalAggregation {
  projectId: string;
  projectName: string;
  criticals: AggregatedVuln[]; // only critical ones
}

@Injectable()
export class ReportMailCron implements OnModuleInit {
  private mailClient: MailReportServiceClient;
  private projectClient: ProjectServiceClient;
  private slackClient: SlackServiceClient;
  constructor(
    private readonly logger: Logger,
    private readonly aggregation: ReportAggregationService,
    @Inject('GLOBAL_MANAGEMENT_SERVICE') private readonly gmClient: ClientGrpc,
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly eiClient: ClientGrpc,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: AnalysisReportingEntitlementsPort,
  ) {}

  onModuleInit() {
    this.mailClient = this.gmClient.getService<MailReportServiceClient>(
      MAIL_REPORT_SERVICE_NAME,
    );
    this.projectClient =
      this.gmClient.getService<ProjectServiceClient>(PROJECT_SERVICE_NAME);
    this.slackClient =
      this.eiClient.getService<SlackServiceClient>(SLACK_SERVICE_NAME);
    this.logger.log('ReportMailCron initialized');
  }

  private async fetchEligibleProjects(flags: {
    weekly?: boolean;
    monthly?: boolean;
    emailAlert?: boolean;
    weeklySlack?: boolean;
    monthlySlack?: boolean;
  }): Promise<
    {
      projectId: string;
      projectName: string;
      organizationId: string;
      weekly: boolean;
      monthly: boolean;
      email: boolean;
      weeklySlack: boolean;
      monthlySlack: boolean;
    }[]
  > {
    const results: any[] = [];
    let pageNumber = 1;
    for (;;) {
      let page;
      try {
        page = await safeGrpcCall(
          this.projectClient.getAllProjects({
            pageNumber,
            pageSizeNumber: 200,
            weekly: flags.weekly,
            monthly: flags.monthly,
            emailAlert: flags.emailAlert,
            weeklySlack: flags.weeklySlack,
            monthlySlack: flags.monthlySlack,
            zeroDayEmail: false,
            zeroDaySlack: false,
            scanCompleteEmail: false,
            scanCompleteSlack: false,
          }),
        );
        this.logger.log(
          `[DailyCriticalAlertsCron] Fetched projects count function=${page.projects.length}`,
        );
      } catch (e) {
        this.logger.error(
          { err: e, pageNumber },
          'Error fetching projects for reports',
        );
        break;
      }
      if (!page || !page.projects || page.projects.length === 0) break;
      for (const p of page.projects) {
        results.push({
          projectId: p.projectId,
          projectName: p.name,
          organizationId: p.organizationId,
          weekly: !!p.weeklyReportEnabled,
          monthly: !!p.monthlyReportEnabled,
          email: !!p.emailAlertEnabled,
          weeklySlack: !!p.weeklyReportSlackEnabled,
          monthlySlack: !!p.monthlyReportSlackEnabled,
        });
      }
      if (page.totalPages && pageNumber >= page.totalPages) break;
      pageNumber++;
      if (pageNumber > 5000) break; // safety cap
    }
    return results;
  }

  /**
   * The projects of an organisation whose AppSec is known to be off (per the
   * entitlements port) get no e-mail and no Slack message, and are not
   * aggregated. The products are read once per run, in batches. An
   * organisation the entitlements source could not answer for is sent to as
   * before (fail open: an outage must not drop an alert), with one warning
   * for the run. The per-member recipient filter (`appsec_access`) stays
   * global-management's.
   */
  private async withoutAppsecOff<T extends { organizationId: string }>(
    tag: string,
    projects: T[],
  ): Promise<T[]> {
    const { off, failed } = await this.entitlements.getProductsForOrganizations(
      projects.map((p) => p.organizationId).filter((id) => id.trim() !== ''),
    );
    if (failed) {
      this.logger.warn(
        `${tag} AppSec products could not be read for every organisation: their reports are sent as before`,
      );
    }
    if (off.size === 0) return projects;
    const kept = projects.filter((p) => !off.has(p.organizationId));
    this.logger.log(
      `${tag} Skipped ${projects.length - kept.length} projects of ${off.size} organisations whose AppSec is off`,
    );
    return kept;
  }

  /**
   * The branches archived in a project: their findings are left out of its
   * report. When global-management cannot answer, the report counts every
   * branch, as before, and says so.
   */
  private async archivedBranchesOf(
    tag: string,
    projectId: string,
  ): Promise<ReadonlySet<string>> {
    const read = await readArchivedBranches(this.projectClient, projectId);
    if (read.branches) return read.branches;
    this.logger.warn(
      `${tag} archived branches of project ${projectId} could not be read (${read.failure}): its report counts every branch`,
    );
    return new Set();
  }

  private baseToVulnItem(v: AggregatedVuln): VulnerabilityItem {
    // Map only relevant fields; unused become empty strings as proto expects strings.
    // `branch` is forwarded so daily/weekly/monthly reports can group / label the
    // vulnerability by the branch it was detected on. Falls back to an
    // empty string (proto-safe) when the detection has no branch — the templates
    // then skip the branch chip/section via {{#if branch}}.
    const common = {
      id: v.id,
      title: v.title,
      severity: v.severity,
      type: v.type,
      state: v.state,
      cwe: '',
      createdAt: v.createdAt,
      branch: v.branch || '',
    };
    if (v.type === 'SCA' || v.type === 'CONTAINER') {
      return {
        ...common,
        packageName:
          (v as AggregatedScaVuln | AggregatedContainerVuln).packageName || '',
        version:
          (v as AggregatedScaVuln | AggregatedContainerVuln).version || '',
        cvss: (v as AggregatedScaVuln | AggregatedContainerVuln).cvss || '',
      };
    }
    // SAST / IAC / SECRET / CICD (no package / cvss / version by design)
    return {
      ...common,
      packageName: '',
      version: '',
      cvss: '',
    };
  }

  // Invoked by the K8s CronJob analysis-reporting-report-mail-weekly
  // (schedule "0 7 * * 1" in the Helm chart) via CRON_TASK=weekly.
  // NOTE: this used to carry a leftover debug @Cron(EVERY_10_SECONDS) that
  // fired the weekly handler nonstop in the always-on Deployment.
  @Span()
  async runWeekly() {
    this.logger.log('[WeeklyReportCron] Start');
    const projects = await this.withoutAppsecOff(
      '[WeeklyReportCron]',
      await this.fetchEligibleProjects({
        weekly: true,
        weeklySlack: true,
      }),
    );

    // Email reports are consolidated to ONE message per (recipient, org), so we
    // group eligible projects by organization and let global-management fan each
    // org's batch out to the members who can access them. Slack stays per-project.
    const emailProjectsByOrg = new Map<string, WeeklyReportProjectItem[]>();

    for (const p of projects) {
      if (!p.weekly && !p.weeklySlack) continue;
      try {
        const agg = await this.aggregation.aggregateWeekly(
          p.projectId,
          p.projectName,
          await this.archivedBranchesOf('[WeeklyReportCron]', p.projectId),
        );

        // Skip if no vulnerabilities
        if (agg.total === 0) {
          this.logger.log(
            `[WeeklyReportCron] Skipping project ${p.projectName} - no vulnerabilities`,
          );
          continue;
        }

        // Collect for the org-level consolidated email
        if (p.weekly && p.organizationId) {
          const item: WeeklyReportProjectItem = {
            projectId: agg.projectId,
            projectName: agg.projectName,
            severities: agg.severities,
            types: agg.types,
            topRecent: agg.topRecent.map((v) => this.baseToVulnItem(v)),
            total: agg.total,
            newLast7d: agg.newLast7d,
            resolvedLast7d: agg.resolvedLast7d,
          };
          const bucket = emailProjectsByOrg.get(p.organizationId) ?? [];
          bucket.push(item);
          emailProjectsByOrg.set(p.organizationId, bucket);
        }

        // Send Slack notification (still per-project)
        if (p.weeklySlack) {
          try {
            const slackReq: SendSlackNotificationRequest = {
              projectId: agg.projectId,
              notificationType: 'weekly_report',
              payloadJson: JSON.stringify({
                projectId: agg.projectId,
                projectName: agg.projectName,
                severities: agg.severities,
                types: agg.types,
                total: agg.total,
                newCount: agg.newLast7d,
                resolvedCount: agg.resolvedLast7d,
              }),
            };
            await safeGrpcCall(this.slackClient.sendNotification(slackReq));
          } catch (slackErr: any) {
            this.logger.error(
              { err: slackErr, projectId: p.projectId },
              `Weekly Slack notification failed for project ${p.projectId}: ${slackErr.message}`,
            );
          }
        }
      } catch (e: any) {
        this.logger.error(
          { err: e, projectId: p.projectId },
          `Weekly report failed for project ${p.projectId}: ${e.message}`,
        );
      }
    }

    // One consolidated email request per organization
    for (const [organizationId, orgProjects] of emailProjectsByOrg) {
      try {
        const req: ConsolidatedWeeklyReportRequest = {
          organizationId,
          projects: orgProjects,
        };
        await safeGrpcCall(this.mailClient.sendConsolidatedWeeklyReport(req));
      } catch (e: any) {
        this.logger.error(
          { err: e, organizationId },
          `Consolidated weekly report failed for org ${organizationId}: ${e.message}`,
        );
      }
    }

    this.logger.log(`[WeeklyReportCron] End processed=${projects.length}`);
  }

  // Invoked by the K8s CronJob analysis-reporting-report-mail-monthly
  // (schedule "30 7 1 * *" in the Helm chart) via CRON_TASK=monthly.
  @Span()
  async runMonthly() {
    this.logger.log('[MonthlyReportCron] Start');
    const projects = await this.withoutAppsecOff(
      '[MonthlyReportCron]',
      await this.fetchEligibleProjects({
        monthly: true,
        monthlySlack: true,
      }),
    );

    const emailProjectsByOrg = new Map<string, MonthlyReportProjectItem[]>();

    for (const p of projects) {
      if (!p.monthly && !p.monthlySlack) continue;
      try {
        // Use aggregation service to get complete vulnerability data including topRecent list
        const agg = await this.aggregation.aggregateMonthly(
          p.projectId,
          p.projectName,
          await this.archivedBranchesOf('[MonthlyReportCron]', p.projectId),
        );

        if (agg.total === 0) {
          continue;
        }

        // Collect for the org-level consolidated email
        if (p.monthly && p.organizationId) {
          const item: MonthlyReportProjectItem = {
            projectId: agg.projectId,
            projectName: agg.projectName,
            severities: agg.severities,
            types: agg.types,
            topRecent: agg.topRecent.map((v) => this.baseToVulnItem(v)),
            total: agg.total,
            newLast30d: agg.newLast30d,
            resolvedLast30d: agg.resolvedLast30d,
          };
          const bucket = emailProjectsByOrg.get(p.organizationId) ?? [];
          bucket.push(item);
          emailProjectsByOrg.set(p.organizationId, bucket);
        }

        // Send Slack notification (still per-project)
        if (p.monthlySlack) {
          try {
            const slackReq: SendSlackNotificationRequest = {
              projectId: agg.projectId,
              notificationType: 'monthly_report',
              payloadJson: JSON.stringify({
                projectId: agg.projectId,
                projectName: agg.projectName,
                severities: agg.severities,
                types: agg.types,
                total: agg.total,
                newCount: agg.newLast30d,
                resolvedCount: agg.resolvedLast30d,
              }),
            };
            await safeGrpcCall(this.slackClient.sendNotification(slackReq));
          } catch (slackErr: any) {
            this.logger.error(
              { err: slackErr, projectId: p.projectId },
              `Monthly Slack notification failed for project ${p.projectId}: ${slackErr.message}`,
            );
          }
        }
      } catch (e: any) {
        this.logger.error(
          { err: e, projectId: p.projectId },
          `Monthly report failed for project ${p.projectId}: ${e.message}`,
        );
      }
    }

    // One consolidated email request per organization
    for (const [organizationId, orgProjects] of emailProjectsByOrg) {
      try {
        const req: ConsolidatedMonthlyReportRequest = {
          organizationId,
          projects: orgProjects,
        };
        await safeGrpcCall(this.mailClient.sendConsolidatedMonthlyReport(req));
      } catch (e: any) {
        this.logger.error(
          { err: e, organizationId },
          `Consolidated monthly report failed for org ${organizationId}: ${e.message}`,
        );
      }
    }

    this.logger.log(`[MonthlyReportCron] End processed=${projects.length}`);
  }

  // Invoked by the K8s CronJob analysis-reporting-report-mail-daily
  // (schedule "0 8 * * *" in the Helm chart) via CRON_TASK=daily.
  @Span()
  async runDailyCritical() {
    this.logger.log('[DailyCriticalAlertsCron] Start');
    const projects = await this.withoutAppsecOff(
      '[DailyCriticalAlertsCron]',
      await this.fetchEligibleProjects({ emailAlert: true }),
    );
    this.logger.log(
      `[DailyCriticalAlertsCron] Fetched projects count=${projects.length}`,
    );

    const projectsByOrg = new Map<string, DailyCriticalReportProjectItem[]>();

    for (const p of projects) {
      if (!p.email) continue;
      try {
        const agg = (await this.aggregation.aggregateDailyCritical(
          p.projectId,
          p.projectName,
          await this.archivedBranchesOf(
            '[DailyCriticalAlertsCron]',
            p.projectId,
          ),
        )) as unknown as DailyCriticalAggregation;

        if (!agg.criticals.length) {
          continue;
        }

        if (p.organizationId) {
          const item: DailyCriticalReportProjectItem = {
            projectId: agg.projectId,
            projectName: agg.projectName,
            criticals: agg.criticals.map((v) => this.baseToVulnItem(v)),
            count: agg.criticals.length,
          };
          const bucket = projectsByOrg.get(p.organizationId) ?? [];
          bucket.push(item);
          projectsByOrg.set(p.organizationId, bucket);
        }
      } catch (e: any) {
        this.logger.error(
          { err: e, projectId: p.projectId },
          `Daily critical alerts failed for project ${p.projectId}: ${e.message}`,
        );
      }
    }

    // One consolidated email request per organization
    for (const [organizationId, orgProjects] of projectsByOrg) {
      try {
        const req: ConsolidatedDailyCriticalReportRequest = {
          organizationId,
          projects: orgProjects,
        };
        await safeGrpcCall(
          this.mailClient.sendConsolidatedDailyCriticalReport(req),
        );
      } catch (e: any) {
        this.logger.error(
          { err: e, organizationId },
          `Consolidated daily critical report failed for org ${organizationId}: ${e.message}`,
        );
      }
    }

    this.logger.log(
      `[DailyCriticalAlertsCron] End processed=${projects.length}`,
    );
  }
}
