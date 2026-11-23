import type { PurgeTable } from '../../modules/data-purge/purge-tables';

/**
 * Extension token: the closed tables a purge deletes on top of the core
 * lists of purge-tables.ts. Only a closed module supplies it; when the token
 * is absent (the Community Edition) the core lists only are purged, so a
 * Community database never names a table it lacks.
 */
export const PURGE_TABLE_EXTENSIONS = 'PURGE_TABLE_EXTENSIONS';

export interface PurgeTableExtension {
  /** Deleted by the project id, after the core project tables. */
  project: readonly PurgeTable[];
  /**
   * Deleted by the organization id, before the core organization tables
   * and before the integrations themselves.
   */
  organization: readonly PurgeTable[];
}
