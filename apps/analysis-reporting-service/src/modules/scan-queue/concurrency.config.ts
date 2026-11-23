import { QUEUE_NAMES } from './queue-names';
import { resolveConcurrency } from './concurrency.util';

/**
 * Central concurrency configuration for all BullMQ processors.
 *
 * Each entry maps a queue name to its env-var name and default concurrency.
 * IO-bound ingestion queues (SCA, SAST_IAC, CONTAINER) default to 3; all
 * others keep their current defaults but become env-tunable for operator
 * overrides. Closed queues have their own table.
 */
export interface QueueConcurrencyConfig {
  envVar: string;
  defaultConcurrency: number;
}

export const QUEUE_CONCURRENCY_CONFIG: Record<
  keyof typeof QUEUE_NAMES,
  QueueConcurrencyConfig
> = {
  SCA: { envVar: 'SCA_CONCURRENCY', defaultConcurrency: 3 },
  SAST_IAC: { envVar: 'SAST_IAC_CONCURRENCY', defaultConcurrency: 3 },
  CONTAINER: { envVar: 'CONTAINER_CONCURRENCY', defaultConcurrency: 3 },
  CVSS_RECALCULATION: {
    envVar: 'CVSS_CONCURRENCY',
    defaultConcurrency: 1,
  },
  // AGENT_REANALYSIS moved to EE_QUEUE_CONCURRENCY_CONFIG.
  CYBERISK_RECOMPUTE: {
    envVar: 'CYBERISK_CONCURRENCY',
    defaultConcurrency: 4,
  },
  ORG_STATISTICS_RECOMPUTE: {
    envVar: 'ORG_STATISTICS_CONCURRENCY',
    defaultConcurrency: 2,
  },
  REPORTS: { envVar: 'REPORTS_CONCURRENCY', defaultConcurrency: 1 },
  AGGREGATED_REPORTS: {
    envVar: 'AGGREGATED_REPORTS_CONCURRENCY',
    defaultConcurrency: 1,
  },
  // SCA_AUTOFIX moved to EE_QUEUE_CONCURRENCY_CONFIG.
  VULN_BATCH_UPDATE: {
    envVar: 'VULN_BATCH_UPDATE_CONCURRENCY',
    defaultConcurrency: 2,
  },
  // A handful of jobs a day at most (a scanner given up).
  SCAN_END_EVALUATION: {
    envVar: 'SCAN_END_EVALUATION_CONCURRENCY',
    defaultConcurrency: 1,
  },
  // One import at a time per worker (≤ 3 concurrent statements);
  // raising it means raising the worker pool too.
  RESULTS_IMPORT: {
    envVar: 'RESULTS_IMPORT_CONCURRENCY',
    defaultConcurrency: 1,
  },
};

/**
 * Convenience helper: resolves the effective concurrency for a given queue key
 * using the current process environment.
 */
export function getQueueConcurrency(queue: keyof typeof QUEUE_NAMES): number {
  const { envVar, defaultConcurrency } = QUEUE_CONCURRENCY_CONFIG[queue];
  return resolveConcurrency(process.env[envVar], defaultConcurrency);
}
