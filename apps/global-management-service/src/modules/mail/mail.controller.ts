import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { MailService } from './mail.service';
import {
  WeeklyProjectReportRequest,
  MonthlyProjectReportRequest,
  DailyCriticalAlertsRequest,
  ScanCompleteReportRequest,
  ConsolidatedWeeklyReportRequest,
  ConsolidatedMonthlyReportRequest,
  ConsolidatedDailyCriticalReportRequest,
  MailAckResponse,
} from '@grpc/global-management/mail';
import { Span } from 'nestjs-otel';

/**
 * Core `MailReportService` handlers. Each RPC carries an explicit
 * `@GrpcMethod`: the closed mail RPCs of this service are served by
 * controllers of the closed edition, and stripped from the exported proto,
 * so the class decorator over the whole generated interface is gone.
 */
@Controller()
export class MailController {
  constructor(private readonly mail: MailService) {}

  @GrpcMethod('MailReportService', 'SendWeeklyProjectReport')
  @Span()
  async sendWeeklyProjectReport(
    request: WeeklyProjectReportRequest,
  ): Promise<MailAckResponse> {
    await this.mail.sendWeeklyProjectReportEmail({
      projectId: request.projectId,
      projectName: request.projectName,
      severities: request.severities || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      types: request.types || {
        sast: 0,
        iac: 0,
        sca: 0,
        container: 0,
      },
      topRecent: request.topRecent.map((v) => ({
        id: v.id,
        title: v.title,
        severity: v.severity,
        type: v.type as any,
        state: v.state,
        cwe: v.cwe || undefined,
        packageName: v.packageName || undefined,
        version: v.version || undefined,
        createdAt: v.createdAt,
        cvss: v.cvss || undefined,
      })),
      total: request.total,
      newLast7d: request.newLast7d,
      resolvedLast7d: request.resolvedLast7d,
    });
    return { success: true, message: 'weekly mail queued' };
  }

  @GrpcMethod('MailReportService', 'SendMonthlyProjectReport')
  @Span()
  async sendMonthlyProjectReport(
    request: MonthlyProjectReportRequest,
  ): Promise<MailAckResponse> {
    await this.mail.sendMonthlyProjectReportEmail({
      projectId: request.projectId,
      projectName: request.projectName,
      severities: request.severities || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      types: request.types || {
        sast: 0,
        iac: 0,
        sca: 0,
        container: 0,
      },
      topRecent: request.topRecent.map((v) => ({
        id: v.id,
        title: v.title,
        severity: v.severity,
        type: v.type as any,
        state: v.state,
        createdAt: v.createdAt,
        cvss: v.cvss || undefined,
      })),
      total: request.total,
      newLast30d: request.newLast30d,
      resolvedLast30d: request.resolvedLast30d,
    });
    return { success: true, message: 'monthly mail queued' };
  }

  @GrpcMethod('MailReportService', 'SendDailyCriticalAlerts')
  @Span()
  async sendDailyCriticalAlerts(
    request: DailyCriticalAlertsRequest,
  ): Promise<MailAckResponse> {
    await this.mail.sendDailyCriticalAlertsEmail({
      projectId: request.projectId,
      projectName: request.projectName,
      criticals: request.criticals.map((v) => ({
        id: v.id,
        title: v.title,
        severity: v.severity,
        type: v.type as any,
        state: v.state,
        createdAt: v.createdAt,
        cvss: v.cvss || undefined,
        packageName: v.packageName || undefined,
        version: v.version || undefined,
      })),
    });
    return { success: true, message: 'daily critical alerts mail queued' };
  }

  @GrpcMethod('MailReportService', 'SendScanCompleteReport')
  @Span()
  async sendScanCompleteReport(
    request: ScanCompleteReportRequest,
  ): Promise<MailAckResponse> {
    await this.mail.sendScanCompleteReportEmail({
      projectId: request.projectId,
      projectName: request.projectName,
      scanId: request.scanId,
      severities: request.severities || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      types: request.types || {
        sast: 0,
        iac: 0,
        sca: 0,
        container: 0,
      },
      total: request.total,
      topVulnerabilities: request.topVulnerabilities.map((v) => ({
        id: v.id,
        title: v.title,
        severity: v.severity,
        type: v.type as any,
        state: v.state,
        createdAt: v.createdAt,
        cvss: v.cvss || undefined,
        packageName: v.packageName || undefined,
        version: v.version || undefined,
      })),
      scannerType: request.scannerType,
      branch: request.branch || '',
    });
    return { success: true, message: 'scan complete report mail queued' };
  }

  @GrpcMethod('MailReportService', 'SendConsolidatedWeeklyReport')
  @Span()
  async sendConsolidatedWeeklyReport(
    request: ConsolidatedWeeklyReportRequest,
  ): Promise<MailAckResponse> {
    await this.mail.sendConsolidatedWeeklyReportEmail({
      organizationId: request.organizationId,
      projects: request.projects.map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        severities: p.severities || { critical: 0, high: 0, medium: 0, low: 0 },
        total: p.total,
        topRecent: p.topRecent.map((v) => ({
          title: v.title,
          severity: v.severity,
          type: v.type,
          packageName: v.packageName || undefined,
          version: v.version || undefined,
          cvss: v.cvss || undefined,
          createdAt: v.createdAt,
          branch: v.branch || undefined,
        })),
      })),
    });
    return { success: true, message: 'consolidated weekly mail queued' };
  }

  @GrpcMethod('MailReportService', 'SendConsolidatedMonthlyReport')
  @Span()
  async sendConsolidatedMonthlyReport(
    request: ConsolidatedMonthlyReportRequest,
  ): Promise<MailAckResponse> {
    await this.mail.sendConsolidatedMonthlyReportEmail({
      organizationId: request.organizationId,
      projects: request.projects.map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        severities: p.severities || { critical: 0, high: 0, medium: 0, low: 0 },
        total: p.total,
        topRecent: p.topRecent.map((v) => ({
          title: v.title,
          severity: v.severity,
          type: v.type,
          packageName: v.packageName || undefined,
          version: v.version || undefined,
          cvss: v.cvss || undefined,
          createdAt: v.createdAt,
          branch: v.branch || undefined,
        })),
      })),
    });
    return { success: true, message: 'consolidated monthly mail queued' };
  }

  @GrpcMethod('MailReportService', 'SendConsolidatedDailyCriticalReport')
  @Span()
  async sendConsolidatedDailyCriticalReport(
    request: ConsolidatedDailyCriticalReportRequest,
  ): Promise<MailAckResponse> {
    await this.mail.sendConsolidatedDailyCriticalReportEmail({
      organizationId: request.organizationId,
      projects: request.projects.map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        count: p.count,
        criticals: p.criticals.map((v) => ({
          title: v.title,
          severity: v.severity,
          type: v.type,
          packageName: v.packageName || undefined,
          version: v.version || undefined,
          cvss: v.cvss || undefined,
          createdAt: v.createdAt,
          branch: v.branch || undefined,
        })),
      })),
    });
    return {
      success: true,
      message: 'consolidated daily critical mail queued',
    };
  }
}
