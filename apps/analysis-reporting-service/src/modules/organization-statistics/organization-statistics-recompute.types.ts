export interface OrgStatisticsRecomputeJobData {
  organizationId: string;
}

/** Per-org jobId so bursts coalesce into one in-flight drain across replicas. */
export const buildOrgStatsJobId = (organizationId: string): string =>
  `org-stats-${organizationId}`;
