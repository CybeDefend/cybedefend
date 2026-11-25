/**
 * The entitlements port (one copy per service, this one is
 * analysis-reporting's). The core asks the edition layer what an
 * organisation may do; the closed billing domain answers in the cloud.
 */
export const ENTITLEMENTS_PORT = 'ENTITLEMENTS_PORT';

export interface WritableState {
  writable: boolean;
  trial: boolean;
  reason?: string;
}

export interface EntitlementsPort {
  isWritable(organizationId: string): Promise<WritableState>;
  hasFeature(organizationId: string, feature: string): Promise<boolean>;
}

export interface AppsecOffOrganizations {
  /** Organisations billing reports with AppSec not active, or unpaid. */
  off: Set<string>;
  /**
   * True when at least one batch could not be read. Its organisations are
   * not in `off`: they are sent to as before (fail open).
   */
  failed: boolean;
}

export interface ReportEntitlements {
  maxStoredReports?: number;
  reportRetentionDays?: number;
}

export interface AnalysisReportingEntitlementsPort extends EntitlementsPort {
  /**
   * Organisations whose AppSec is known off. Community: `{ off: new Set(),
   * failed: false }`. Cloud: batches of 200, 10 s each, never throws.
   */
  getProductsForOrganizations(
    organizationIds: Iterable<string>,
  ): Promise<AppsecOffOrganizations>;
  /**
   * The plan's report limits. Community: `{ maxStoredReports: 500,
   * reportRetentionDays: -1 }` unless the instance's environment sets them.
   * Cloud: billing GetEntitlements `.data`;
   * REJECTS on any error (callers fail open, unchanged).
   */
  getEntitlements(organizationId: string): Promise<ReportEntitlements>;
}
