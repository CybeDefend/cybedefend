import { ident } from '@cybedefend/db-dialect';
import type { PurgeMatch } from './batched-delete';

/** A column of an extra condition, quoted for the service's engine. */
const col = (name: string): string => ident(name).text;

/**
 * What analysis-reporting deletes for a deleted project, team or organization.
 *
 * `data-purge.inventory.spec.ts` fails on any table that carries a project,
 * team or organization key and is neither listed here nor in KEPT_TABLES:
 * a new table must say which.
 *
 * `table` and `column` are database names. `where` is an extra constant
 * condition written for the service's engine (its columns through `ident`),
 * never built from a request. `match` (default `equals`) says how
 * the purged id is compared with `column`; it is always a placeholder.
 */
export interface PurgeTable {
  table: string;
  column: string;
  where?: string;
  match?: PurgeMatch;
}

/**
 * In this order: the children that carry their own `projectId` before their
 * parents; everything else (code_snippet, history_item, data_flow_item,
 * vulnerability_detection_history, container_detected_packages under an
 * image) goes by the database cascade, the parents being deleted in batches.
 */
export const PROJECT_PURGE_TABLES: readonly PurgeTable[] = [
  { table: 'autofix_records', column: 'projectId' },
  { table: 'sca_autofix_records', column: 'projectId' },
  // The SCA autofix job table moved to EE_PURGE_TABLES with its entity
  // (closed SCA autofix module).
  { table: 'vulnerability_detections_secret', column: 'projectId' },
  { table: 'vulnerability_detections_cicd', column: 'projectId' },
  { table: 'vulnerability_detections_sast', column: 'projectId' },
  { table: 'vulnerability_detections_iac', column: 'projectId' },
  { table: 'vulnerability_detections_sca', column: 'projectId' },
  { table: 'vulnerability_detections_container', column: 'projectId' },
  { table: 'sca_detected_packages', column: 'projectId' },
  { table: 'container_detected_packages', column: 'projectId' },
  { table: 'container_detected_images', column: 'projectId' },
  // The advisory content a results import declared for the project.
  { table: 'imported_advisory', column: 'projectId' },
  // aibom_components and aibom_compliance_reports moved to
  // EE_PURGE_TABLES with their entities (closed AI-BOM module).
  { table: 'project_cyber_risk', column: 'project_id' },
  { table: 'owasp_reports', column: 'projectId' },
  { table: 'cwe_reports', column: 'projectId' },
  // sbom_reports moved to EE_PURGE_TABLES with its entity (closed SBOM
  // report module).
  { table: 'generated_reports', column: 'projectId' },
  // A batch report written before organization_id existed (no backfill) can
  // be reached by no organization purge: it goes with any project it covers.
  // A batch report with an organization id is that organization's document
  // (its file is under reports/<orgId>/) and goes with the organization.
  {
    table: 'aggregated_reports',
    column: 'scope_id',
    match: 'find_in_set',
    where: `${col('scope_type')} = 'batch' AND ${col('organization_id')} IS NULL`,
  },
];

/** A team's reports: the aggregated reports whose scope is that team. */
export const TEAM_PURGE_TABLES: readonly PurgeTable[] = [
  {
    table: 'aggregated_reports',
    column: 'scope_id',
    where: `${col('scope_type')} = 'team'`,
  },
];

/**
 * The organization's rows. `aggregated_reports.organization_id` was added
 * without a backfill: older organization-scope rows are matched by their scope
 * here, older team-scope rows by TEAM_PURGE_TABLES for each of the request's
 * team ids.
 */
export const ORGANIZATION_PURGE_TABLES: readonly PurgeTable[] = [
  { table: 'aggregated_reports', column: 'organization_id' },
  {
    table: 'aggregated_reports',
    column: 'scope_id',
    where: `${col('scope_type')} = 'organization'`,
  },
  { table: 'organization_statistics', column: 'organization_id' },
  { table: 'sca_license_overrides', column: 'organizationId' },
  { table: 'imported_advisory', column: 'organizationId' },
];

/** Tables whose key column matches the inventory but holds no customer scope. */
export const KEPT_TABLES: Readonly<Record<string, string>> = {
  vulnerability_osv:
    'OSV advisory catalogue: internalId is the advisory id, shared by every customer, not a project',
};

/**
 * Redis keys of a project, deleted with its rows. The SCA AutoFix
 * job index and live-job set moved to EE_PURGE_TABLES with the SCA_AUTOFIX
 * queue.
 */
export const projectRedisKeys = (projectId: string): string[] => [
  `cyberisk:dirty:${projectId}`,
];

/**
 * Redis keys of an organization, deleted with its rows. The SCA
 * AutoFix live-job set moved to EE_PURGE_TABLES.
 */
export const organizationRedisKeys = (organizationId: string): string[] => [
  `ovw:gen:${organizationId}`,
];
