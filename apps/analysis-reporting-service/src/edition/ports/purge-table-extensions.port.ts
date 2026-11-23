import type { PurgeTable } from '../../modules/data-purge/purge-tables';

/**
 * Extension token: the closed tables and Redis keys a
 * purge deletes on top of the core lists of purge-tables.ts (I-10). Only an
 * ee module supplies it (EePurgeModule); when the token is
 * absent — the Community Edition — the core lists only are purged, so a
 * Community database never names a table it lacks.
 */
export const PURGE_TABLE_EXTENSIONS = 'PURGE_TABLE_EXTENSIONS';

export interface PurgeTableExtension {
  project: readonly PurgeTable[];
  team: readonly PurgeTable[];
  organization: readonly PurgeTable[];
  projectRedisKeys(projectId: string): string[];
  organizationRedisKeys(organizationId: string): string[];
}
