import { Inject, Injectable, Optional } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { Span } from 'nestjs-otel';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { PdfGeneratorService } from '../../../../core/utils/pdf-generator.service';
import {
  AggregatedReportOptions,
  footerTitle,
} from '../templates/aggregated-common';
import {
  renderSecurityReport,
  SECURITY_REPORT_TITLES,
} from '../templates/security-template';
import {
  LICENSE_REPORT_TITLE,
  renderLicenseReport,
} from '../templates/license-template';
import {
  AGGREGATED_REPORT_KINDS,
  AggregatedReportKind,
} from '../../../../edition/ports/aggregated-report-kinds.port';

/**
 * Builds the aggregated reports (organization, team or custom selection) in
 * JSON, HTML (dashboard preview) or PDF. The documents are rendered by the
 * templates of `../templates` on the shared report design system.
 */
@Injectable()
export class ReportBuilderService {
  constructor(
    private readonly logger: Logger,
    private readonly pdfGeneratorService: PdfGeneratorService,
    // The closed report types (EU AI Act) render themselves; they
    // are registered by an ee module, absent in the Community Edition.
    @Optional()
    @Inject(AGGREGATED_REPORT_KINDS)
    registeredKinds?: AggregatedReportKind[],
  ) {
    this.kinds = new Map((registeredKinds ?? []).map((k) => [k.reportType, k]));
  }

  private readonly kinds: Map<string, AggregatedReportKind>;

  @Span()
  async buildReport(
    options: AggregatedReportOptions,
  ): Promise<{ content: Buffer; filename: string; contentType: string }> {
    const { format, scopeType, reportType, metadata } = options;

    const timestamp = new Date().toISOString().split('T')[0];
    const scopeId = metadata?.id || 'unknown';
    const baseFilename = `${reportType}-${scopeType}-report-${scopeId}-${timestamp}`;

    if (format === 'json') {
      return {
        content: Buffer.from(JSON.stringify(options.aggregatedData, null, 2)),
        filename: `${baseFilename}.json`,
        contentType: 'application/json',
      };
    }
    if (format === 'html') {
      return {
        content: Buffer.from(this.render(options, false)),
        filename: `${baseFilename}.html`,
        contentType: 'text/html',
      };
    }
    if (format === 'pdf') {
      const pdf = await this.pdfGeneratorService.generatePDF(
        this.render(options, true),
        {
          waitForSelector: '.footer',
          timeout: 30000,
          footerTitle: footerTitle(this.titleOf(reportType), options),
        },
      );
      return {
        content: pdf,
        filename: `${baseFilename}.pdf`,
        contentType: 'application/pdf',
      };
    }
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `Invalid format`,
    });
  }

  private titleOf(reportType: string): string {
    if (reportType === 'owasp') return SECURITY_REPORT_TITLES.owasp;
    if (reportType === 'license') return LICENSE_REPORT_TITLE;
    const kind = this.kinds.get(reportType);
    if (kind) return kind.title;
    return SECURITY_REPORT_TITLES.cwe;
  }

  private render(options: AggregatedReportOptions, forPdf: boolean): string {
    switch (options.reportType) {
      case 'owasp':
        return renderSecurityReport('owasp', options, forPdf);
      case 'license':
        return renderLicenseReport(options, forPdf);
      default: {
        const kind = this.kinds.get(options.reportType);
        if (kind) return kind.render(options, forPdf);
        return renderSecurityReport('cwe', options, forPdf);
      }
    }
  }
}
