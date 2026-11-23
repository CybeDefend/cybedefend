import type { ServiceAuthPolicy } from './service-auth';

const SCAN_SERVICE = '/cybedefend.security_scanning.ScanService';

/**
 * security-scanning's own rules, closed by default: each gRPC service answers
 * the callers listed for it. The scanner pods, which hold no service key,
 * call the scanner methods only, and only a deployment that routes them here
 * lets them in unsigned (SERVICE_AUTH_ALLOW_SCANNER_CALLS).
 */
export const SERVICE_AUTH_POLICY: ServiceAuthPolicy = {
  caller: 'security-scanning',
  services: {
    'cybedefend.security_scanning.ScanService': [
      'gateway',
      'global-management',
      'analysis-reporting',
      'file-management',
      'external-integrations',
    ],
    'cybedefend.security_scanning.ClusterScanService': [
      'gateway',
      'external-integrations',
    ],
    // The data purge runner.
    'cybedefend.security_scanning.DataPurgeService': ['global-management'],
  },
  methods: {},
  scannerMethods: [
    `${SCAN_SERVICE}/GetScan`,
    `${SCAN_SERVICE}/UpdateScan`,
    `${SCAN_SERVICE}/UpdateScanData`,
  ],
};
