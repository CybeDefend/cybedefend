/**
 * Trigger of a cyberisk-recompute job. Recorded for debugging and
 * metrics; not used to alter the recompute behaviour itself.
 */
export type CyberiskRecomputeTrigger =
  | 'scan_complete'
  | 'vuln_update'
  | 'security_context_update'
  | 'reference_branch_update'
  | 'manual'
  | 'backfill';

export type CyberiskRecomputeJobData = {
  projectId: string;
  trigger: CyberiskRecomputeTrigger;
};

export function buildCyberiskJobId(projectId: string): string {
  // NOTE: BullMQ forbids ':' in custom job ids (it is the internal key
  // separator and throws "Custom Id cannot contain :"). Use a '-' so the
  // per-project dedup id stays valid.
  return `cyberisk-${projectId}`;
}
