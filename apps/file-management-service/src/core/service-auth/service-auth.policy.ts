import type { ServiceAuthPolicy } from './service-auth';

/** file-management's own rules, closed by default: each gRPC service answers the callers listed for it. */
export const SERVICE_AUTH_POLICY: ServiceAuthPolicy = {
  caller: 'file-management',
  services: {
    'cybedefend.file_management.FileService': [
      'gateway',
      'security-scanning',
      'analysis-reporting',
      'external-integrations',
    ],
    // The data purge runner.
    'cybedefend.file_management.DataPurgeService': ['global-management'],
  },
  methods: {},
  scannerMethods: [],
};
