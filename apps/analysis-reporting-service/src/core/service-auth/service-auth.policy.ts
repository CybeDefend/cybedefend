import type { ServiceAuthPolicy } from './service-auth';

const RESULT_SERVICE = '/cybedefend.analysis_reporting.ResultService';

/**
 * analysis-reporting's own rules, closed by default: each gRPC service
 * answers the callers listed for it. The scanner pods, which hold no service
 * key, call the scanner methods only, and only a deployment that routes them
 * here lets them in unsigned (SERVICE_AUTH_ALLOW_SCANNER_CALLS).
 */
export const SERVICE_AUTH_POLICY: ServiceAuthPolicy = {
  caller: 'analysis-reporting',
  services: {
    'cybedefend.analysis_reporting.ResultService': [
      'gateway',
      'global-management',
      'security-scanning',
      'policy-management',
    ],
    'cybedefend.analysis_reporting.VulnerabilityService': ['gateway'],
    // The data purge runner.
    'cybedefend.analysis_reporting.DataPurgeService': ['global-management'],
  },
  methods: {},
  scannerMethods: [
    `${RESULT_SERVICE}/AddScanResult`,
    `${RESULT_SERVICE}/AddScaScanResult`,
    `${RESULT_SERVICE}/AddContainerScanResult`,
  ],
};
