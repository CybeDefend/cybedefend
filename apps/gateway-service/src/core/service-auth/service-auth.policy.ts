import type { ServiceAuthPolicy } from './service-auth';

/** The gateway serves no gRPC: it only signs its calls. */
export const SERVICE_AUTH_POLICY: ServiceAuthPolicy = {
  caller: 'gateway',
  services: {},
  methods: {},
  scannerMethods: [],
};
