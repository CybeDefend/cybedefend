import * as Joi from 'joi';
import { secretsValidationKeys } from '../secrets/secrets.validation';
import {
  SCANNER_IMAGE_REGISTRY_PATTERN,
  SCANNER_IMAGE_TAG_PATTERN,
  SCANNER_KEEP_PODS_PATTERN,
  SCANNER_ALLOW_INSECURE_TLS_PATTERN,
  SCANNER_TRIVY_DB_REPOSITORY_PATTERN,
  SCANNER_MAX_CONCURRENT_PATTERN,
  SCANNER_NAMESPACE_PATTERN,
  SCANNER_PULL_SECRET_PATTERN,
} from '../../modules/cluster-scanning/cluster-scanning.config';

export const validationSchema = Joi.object({
  // The secrets block (secrets.validation.ts).
  ...secretsValidationKeys,

  // The database engine. The Community Edition refuses mysql at boot
  // (DB_TYPE_NOT_SUPPORTED, src/core/db/typeorm-options.ts).
  DB_TYPE: Joi.string().valid('mysql', 'postgres').default('mysql'),
  // MUST stay a string: the chart injects "true" and every TypeORM factory
  // compares against the string 'true'. Joi.boolean() would coerce it and
  // silently disable TLS on every MySQL connection.
  DB_SSL_ENABLED: Joi.string().valid('true', 'false').default('false'),
  GRPC_URL: Joi.string().default('0.0.0.0:50051'),
  GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: Joi.string().required(),
  GRPC_URL_SECURITY_SCANNING_SERVICE: Joi.string().required(),
  GRPC_URL_FILE_MANAGEMENT_SERVICE: Joi.string().required(),
  // Required only outside the Community Edition — the AI agent
  // client that reads it is closed.
  GRPC_URL_AGENT_SERVICE: Joi.when('CYBEDEFEND_EDITION', {
    is: 'community',
    then: Joi.string().optional(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.string().required(),
  }),
  NODE_ENV: Joi.string().valid('development', 'production'),
  CYBEDEFEND_EDITION: Joi.string()
    .valid('community', 'cloud', 'enterprise')
    .default('cloud'),
  // Required only outside the Community Edition — the Kubernetes pod
  // management that reads it is closed.
  KUBERNETES_ENV: Joi.when('CYBEDEFEND_EDITION', {
    is: 'community',
    then: Joi.string().valid('local', 'gke', 'kubeconfig').optional(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.string().valid('local', 'gke', 'kubeconfig').required(),
  }),
  KUBERNETES_LOCAL_CONTEXT: Joi.when('KUBERNETES_ENV', {
    is: 'local',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  GKE_CLUSTER: Joi.when('KUBERNETES_ENV', {
    is: 'gke',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  GKE_ZONE: Joi.when('KUBERNETES_ENV', {
    is: 'gke',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  GCR_NAME: Joi.when('STORAGE_PROVIDER', {
    is: 'gcp',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  // Required only outside the Community Edition — the scanner pods
  // it allow-lists never run there.
  ALLOWED_SCAN_IPS: Joi.when('CYBEDEFEND_EDITION', {
    is: 'community',
    then: Joi.string().optional(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.string().required(),
  }),
  GCP_PROJECT_ID: Joi.when('KUBERNETES_ENV', {
    is: 'gke',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  GCP_BUCKET_NAME: Joi.when('STORAGE_PROVIDER', {
    is: 'gcp',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  // Storage provider: 'gcp' or 's3' (any S3-compatible store, e.g. MinIO)
  STORAGE_PROVIDER: Joi.string().valid('gcp', 's3').default('gcp'),
  // S3-compatible storage configuration (required when STORAGE_PROVIDER = 's3')
  S3_ENDPOINT: Joi.when('STORAGE_PROVIDER', {
    is: 's3',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  S3_BUCKET_NAME: Joi.when('STORAGE_PROVIDER', {
    is: 's3',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  SCAN_IMAGE_REGISTRY: Joi.when('KUBERNETES_ENV', {
    is: 'kubeconfig',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  // Namespace of the image scanner pods (kubernete.service.ts
  // containerScannerNamespace): they reach the customer's registry, so they
  // run under their own egress policy. The namespace must exist, and so must
  // the registry pull Secret in it.
  CONTAINER_SCANNER_NAMESPACE: Joi.string()
    .pattern(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/)
    .max(63)
    .default('scanners-namespace'),
  // The FQDN engine of each image scanner pod's own egress policy
  // (container-egress-policy.ts): cilium writes a CiliumNetworkPolicy, gke an
  // FQDNNetworkPolicy. Unset, no pod policy is written.
  CONTAINER_SCAN_EGRESS_POLICY: Joi.string().valid('cilium', 'gke').optional(),
  // The envoy listener of each scanner family (kubernete.service.ts
  // scannerGrpcUrls), host:port; unset = the shared per-service listeners.
  ...Object.fromEntries(
    [
      'SCANNER_GRPC_URL_SAST_IAC',
      'SCANNER_GRPC_URL_SCA',
      'SCANNER_GRPC_URL_AIBOM',
      'SCANNER_GRPC_URL_CONTAINER',
    ].map((name) => [
      name,
      Joi.string()
        .pattern(/^[A-Za-z0-9.-]+:\d{1,5}$/)
        .optional(),
    ]),
  ),
  // Scanner-call authentication (src/core/scanner-auth/scanner-auth.contract.ts).
  SCANNER_AUTH_MODE: Joi.string().valid('verify', 'enforce').default('verify'),
  SCANNER_AUTH_NAMESPACES: Joi.string().default(
    'scanners-namespace,scanners-container-namespace',
  ),
  // No default: @nestjs/config copies Joi defaults into process.env, and the
  // pod builder gives scanner pods a token only when this variable is set.
  // The verifier's default (scanner-grpc) comes from the contract.
  SCANNER_AUTH_SERVICE_ACCOUNT: Joi.string().optional(),
  SCANNER_AUTH_CLOSED_GRACE_SECONDS: Joi.number()
    .integer()
    .min(0)
    .max(3600)
    .default(120),
  // A string, as DB_SSL_ENABLED: the pod builder compares against 'true'.
  SCANNER_GRPC_TLS: Joi.string().valid('true', 'false').default('false'),
  SCANNER_GRPC_CA_SECRET: Joi.string().default('scanner-grpc-ca'),
  // Community scans on a connected Kubernetes cluster
  // (src/modules/cluster-scanning/cluster-scanning.config.ts, which reads them
  // and refuses the kubeconfig file without the namespace, or the reverse).
  // Every key is optional and an empty value counts as unset; the defaults
  // live in the reader.
  CYBEDEFEND_SCANNER_KUBECONFIG_FILE: Joi.string().empty('').optional(),
  CYBEDEFEND_SCANNER_NAMESPACE: Joi.string()
    .empty('')
    .pattern(SCANNER_NAMESPACE_PATTERN)
    .optional(),
  CYBEDEFEND_SCANNER_IMAGE_REGISTRY: Joi.string()
    .empty('')
    .pattern(SCANNER_IMAGE_REGISTRY_PATTERN)
    .optional(),
  CYBEDEFEND_SCANNER_IMAGE_TAG: Joi.string()
    .empty('')
    .pattern(SCANNER_IMAGE_TAG_PATTERN)
    .optional(),
  CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET: Joi.string()
    .empty('')
    .pattern(SCANNER_PULL_SECRET_PATTERN)
    .optional(),
  CYBEDEFEND_SCANNER_MAX_CONCURRENT: Joi.string()
    .empty('')
    .pattern(SCANNER_MAX_CONCURRENT_PATTERN)
    .optional(),
  // JSON per adapter; the reader checks the adapters and the quantities.
  CYBEDEFEND_SCANNER_RESOURCES: Joi.string().empty('').optional(),
  CYBEDEFEND_SCANNER_KEEP_PODS: Joi.string()
    .empty('')
    .pattern(SCANNER_KEEP_PODS_PATTERN)
    .optional(),
  // true accepts a kubeconfig that does not verify the API server's certificate.
  CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS: Joi.string()
    .empty('')
    .pattern(SCANNER_ALLOW_INSECURE_TLS_PATTERN)
    .optional(),
  // A mirror of Trivy's databases for the trivy-fs pod (Trivy's default when unset).
  CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY: Joi.string()
    .empty('')
    .pattern(SCANNER_TRIVY_DB_REPOSITORY_PATTERN)
    .optional(),
  CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY: Joi.string()
    .empty('')
    .pattern(SCANNER_TRIVY_DB_REPOSITORY_PATTERN)
    .optional(),
  OTEL_DISABLED: Joi.string().valid('true', 'false').default('false'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.alternatives().conditional('OTEL_DISABLED', {
    is: 'true',
    then: Joi.string().optional(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.string().required().messages({
      'any.required': `"OTEL_EXPORTER_OTLP_ENDPOINT" is required unless "OTEL_DISABLED" is set to "true"`,
    }),
  }),
});
