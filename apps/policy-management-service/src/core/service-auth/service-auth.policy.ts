import type { ServiceAuthPolicy } from './service-auth';

const PM = 'cybedefend.policy_management';

/** policy-management's own rules, closed by default: each gRPC service answers the callers listed for it. */
export const SERVICE_AUTH_POLICY: ServiceAuthPolicy = {
  caller: 'policy-management',
  services: {
    [`${PM}.PolicyService`]: ['gateway'],
    // A scan that ends asks for its evaluation.
    [`${PM}.PolicyEvaluationService`]: ['gateway', 'security-scanning'],
    [`${PM}.PolicyViolationService`]: ['gateway'],
    // The data purge runner.
    [`${PM}.DataPurgeService`]: ['global-management'],
  },
  methods: {},
  scannerMethods: [],
};
