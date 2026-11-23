/**
 * Entitlements port (each service carries its own copy). The Community
 * implementation answers everything the edition contains.
 *
 * This service's port has no service-specific method: the one core caller is
 * the import start, which only needs `isWritable`.
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
