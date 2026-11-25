import { Injectable } from '@nestjs/common';
import type {
  AnalysisReportingEntitlementsPort,
  AppsecOffOrganizations,
  ReportEntitlements,
  WritableState,
} from '../ports/entitlements.port';

/** Stored reports per organisation when REPORTS_MAX_STORED_PER_ORG is unset. */
export const COMMUNITY_DEFAULT_MAX_STORED_REPORTS = 500;

/** A positive integer, or -1 (unlimited); anything else gives `fallback`. */
function limitFromEnv(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (raw === undefined || raw.trim() === '') return fallback;
  if (value === -1) return -1;
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * The Community Edition has no billing: every organisation is writable, every
 * feature is on and none is AppSec-off.
 *
 * Reports: each organisation keeps at most REPORTS_MAX_STORED_PER_ORG stored
 * reports (default 500, -1 = unlimited), so one organisation cannot fill the
 * instance's storage. Reports never expire unless REPORTS_RETENTION_DAYS sets
 * a retention in days; the expiry is fixed when a report is created, so
 * setting it never deletes reports that already exist.
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
    return {
      maxStoredReports: limitFromEnv(
        process.env.REPORTS_MAX_STORED_PER_ORG,
        COMMUNITY_DEFAULT_MAX_STORED_REPORTS,
      ),
      reportRetentionDays: limitFromEnv(process.env.REPORTS_RETENTION_DAYS, -1),
    };
  }
}
