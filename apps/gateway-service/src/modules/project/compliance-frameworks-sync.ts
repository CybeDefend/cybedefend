/**
 * The optional seam for the compliance-frameworks sync: the closed
 * extension binds it to the security-rules store; the core injects it `@Optional()` and skips the sync
 * when nothing is bound (the Community Edition, or a core module compiled
 * alone in a spec).
 */
export const COMPLIANCE_FRAMEWORKS_SYNC = 'COMPLIANCE_FRAMEWORKS_SYNC';

export interface ComplianceFrameworksSync {
  setComplianceFrameworks(
    projectId: string,
    frameworks: string[],
    bearerToken: string,
  ): Promise<unknown>;
}
