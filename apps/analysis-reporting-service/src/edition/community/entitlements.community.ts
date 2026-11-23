import { Injectable } from '@nestjs/common';
import type {
  AnalysisReportingEntitlementsPort,
  AppsecOffOrganizations,
  ReportEntitlements,
  WritableState,
} from '../ports/entitlements.port';

/**
 * The Community Edition has no billing: every organisation is writable, every
 * feature is on, none is AppSec-off and no report quota applies
 * (-1 = unlimited).
 */
@Injectable()
export class EntitlementsCommunity implements AnalysisReportingEntitlementsPort {
  async isWritable(): Promise<WritableState> {
    return { writable: true, trial: false };
  }

  async hasFeature(): Promise<boolean> {
    return true;
  }

  async getProductsForOrganizations(): Promise<AppsecOffOrganizations> {
    return { off: new Set(), failed: false };
  }

  async getEntitlements(): Promise<ReportEntitlements> {
    return { maxStoredReports: -1, reportRetentionDays: -1 };
  }
}
