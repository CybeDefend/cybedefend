import { createHash } from 'node:crypto';
import { FactoryProvider } from '@nestjs/common';

/**
 * Community scans on a connected Kubernetes cluster: the
 * CYBEDEFEND_SCANNER_* configuration of security-scanning.
 *
 * - CYBEDEFEND_SCANNER_KUBECONFIG_FILE and CYBEDEFEND_SCANNER_NAMESPACE both
 *   set: scanning is configured. Neither: import-only (null). One without the
 *   other: the boot fails with a fixed message.
 * - An empty value counts as unset.
 * - An error names the variable (and, for CYBEDEFEND_SCANNER_RESOURCES, the
 *   adapter and field), never the value: the kubeconfig path and the other
 *   values stay out of the logs.
 *
 * The same patterns back the Joi schema (src/core/config/validation.schema.ts).
 */

/** The cybedefend-scanners image tag this platform release is compatible with. */
export const DEFAULT_SCANNER_IMAGE_TAG = '1.0.0';
export const DEFAULT_SCANNER_IMAGE_REGISTRY = 'ghcr.io/cybedefend';
export const DEFAULT_SCANNER_MAX_CONCURRENT = 2;

/** Provider token; its value is a ClusterScanningConfig, or null when import-only. */
export const CLUSTER_SCANNING_CONFIG = 'CLUSTER_SCANNING_CONFIG';

export type ScannerAdapter =
  | 'opengrep'
  | 'zizmor'
  | 'gitleaks'
  | 'trivy-config'
  | 'trivy-fs';

export const SCANNER_ADAPTERS: readonly ScannerAdapter[] = [
  'opengrep',
  'zizmor',
  'gitleaks',
  'trivy-config',
  'trivy-fs',
];

export interface ScannerResources {
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
}

export interface ClusterScanningConfig {
  kubeconfigFile: string;
  namespace: string;
  imageRegistry: string;
  imageTag: string;
  imagePullSecret: string | null;
  maxConcurrent: number;
  /**
   * CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION: how many scans of
   * one organization run at once, an instance setting (the organization's
   * own stored limit is set by a hosting plan, which this engine does not
   * have, so it is not read). The instance maximum when unset, so an
   * instance with one organization keeps its whole capacity; lower, it
   * reserves slots for the other organizations. Read through
   * organizationScanLimit, which keeps it between 1 and maxConcurrent.
   * Optional in the type so that a configuration built in code may omit it.
   */
  maxConcurrentPerOrganization?: number;
  keepPods: boolean;
  /**
   * CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS=true: accept a kubeconfig whose
   * cluster turns off the verification of the API server's certificate
   * (`insecure-skip-tls-verify: true`, or a plain `http://` server). Off by
   * default: the ServiceAccount token is then sent to whoever answers.
   * Optional in the type so that a configuration built in code may omit it.
   */
  allowInsecureTls?: boolean;
  resources: Record<ScannerAdapter, ScannerResources>;
  /**
   * CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY and
   * CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY: where the trivy-fs pod
   * downloads Trivy's vulnerability and Java databases, handed to it as
   * TRIVY_DB_REPOSITORY and TRIVY_JAVA_DB_REPOSITORY; null (Trivy's own
   * default) when unset. Optional in the type, like allowInsecureTls.
   */
  trivyDbRepository?: string | null;
  trivyJavaDbRepository?: string | null;
  /** `${FRONTEND_URL}/api`: where a scanner pod sends its results. */
  apiUrl: string;
  /** S3_PUBLIC_ENDPOINT: where a scanner pod fetches its archive; null when unset. */
  storagePublicUrl: string | null;
  /**
   * The `cybedefend.io/instance` label of every pod and Secret this instance
   * creates, and of the sweep's selector: `instanceIdOf(FRONTEND_URL)`.
   */
  instanceId: string;
}

/**
 * The instance's public URL as its id is computed from: trimmed, without a
 * trailing slash, scheme and host in lower case (the path keeps its case).
 */
export function normalisedInstanceUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  const match = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/.exec(trimmed);
  return match
    ? `${match[1].toLowerCase()}${match[2].toLowerCase()}${match[3]}`
    : trimmed;
}

/**
 * The id of an instance: the first 16 hex
 * characters of the SHA-256 of its normalised public URL (FRONTEND_URL).
 * Public, distinct per instance and stable, so the orphan sweep of one
 * instance never sees the pods of another sharing the namespace.
 */
export function instanceIdOf(url: string): string {
  return createHash('sha256')
    .update(normalisedInstanceUrl(url))
    .digest('hex')
    .slice(0, 16);
}

export const SCANNER_NAMESPACE_PATTERN = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
export const SCANNER_IMAGE_REGISTRY_PATTERN =
  /^[a-z0-9.-]+(:[0-9]+)?(\/[a-z0-9._-]+)*$/;
export const SCANNER_IMAGE_TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
/** A DNS-1123 subdomain (a Secret name), 253 characters at most. */
export const SCANNER_PULL_SECRET_PATTERN =
  /^(?=.{1,253}$)[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
/** An integer from 1 to 50. */
export const SCANNER_MAX_CONCURRENT_PATTERN = /^(?:[1-9]|[1-4][0-9]|50)$/;
export const SCANNER_KEEP_PODS_PATTERN = /^(?:true|false)$/;
export const SCANNER_ALLOW_INSECURE_TLS_PATTERN = /^(?:true|false)$/;
/**
 * One or more OCI repositories, comma-separated, without a scheme:
 * host[:port]/path[:tag|@digest], 1024 characters at most.
 */
const OCI_REFERENCE =
  '[A-Za-z0-9][A-Za-z0-9._-]*(?::[0-9]{1,5})?(?:/[A-Za-z0-9._-]+)+(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{1,64})?';
export const SCANNER_TRIVY_DB_REPOSITORY_PATTERN = new RegExp(
  `^(?=.{1,1024}$)${OCI_REFERENCE}(?:,${OCI_REFERENCE})*$`,
);
/** A Kubernetes quantity as accepted here: 500m, 1, 0.5, 512Mi, 2Gi. */
export const SCANNER_QUANTITY_PATTERN = /^[0-9]+(\.[0-9]+)?(m|Ki|Mi|Gi)?$/;

/** The catalogue's requests and limits. */
const DEFAULT_RESOURCES: Record<ScannerAdapter, ScannerResources> = {
  opengrep: {
    cpuRequest: '500m',
    cpuLimit: '1',
    memoryRequest: '1Gi',
    memoryLimit: '2Gi',
  },
  zizmor: {
    cpuRequest: '100m',
    cpuLimit: '500m',
    memoryRequest: '256Mi',
    memoryLimit: '512Mi',
  },
  gitleaks: {
    cpuRequest: '250m',
    cpuLimit: '500m',
    memoryRequest: '512Mi',
    memoryLimit: '1Gi',
  },
  'trivy-config': {
    cpuRequest: '250m',
    cpuLimit: '1',
    memoryRequest: '512Mi',
    memoryLimit: '1Gi',
  },
  'trivy-fs': {
    cpuRequest: '500m',
    cpuLimit: '1',
    memoryRequest: '1Gi',
    memoryLimit: '2Gi',
  },
};

const RESOURCE_FIELDS: readonly (keyof ScannerResources)[] = [
  'cpuRequest',
  'cpuLimit',
  'memoryRequest',
  'memoryLimit',
];

const PAIR_MESSAGE =
  'CYBEDEFEND_SCANNER_KUBECONFIG_FILE and CYBEDEFEND_SCANNER_NAMESPACE must be set together, or neither';

const RESOURCES_KEY = 'CYBEDEFEND_SCANNER_RESOURCES';

/** The value of a key, undefined when it is unset or empty. */
const valueOf = (env: NodeJS.ProcessEnv, key: string): string | undefined => {
  const v = env[key];
  return v === undefined || v === '' ? undefined : v;
};

const checked = (
  env: NodeJS.ProcessEnv,
  key: string,
  pattern: RegExp,
  rule: string,
): string | undefined => {
  const v = valueOf(env, key);
  if (v !== undefined && !pattern.test(v)) {
    throw new Error(`${key} ${rule}`);
  }
  return v;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isAdapter = (name: string): name is ScannerAdapter =>
  (SCANNER_ADAPTERS as readonly string[]).includes(name);

const isResourceField = (name: string): name is keyof ScannerResources =>
  (RESOURCE_FIELDS as readonly string[]).includes(name);

function readResources(
  raw: string | undefined,
): Record<ScannerAdapter, ScannerResources> {
  const resources = Object.fromEntries(
    SCANNER_ADAPTERS.map((a) => [a, { ...DEFAULT_RESOURCES[a] }]),
  ) as Record<ScannerAdapter, ScannerResources>;
  if (raw === undefined) return resources;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${RESOURCES_KEY} is not valid JSON`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${RESOURCES_KEY} must be a JSON object keyed by adapter`);
  }
  for (const [adapter, overrides] of Object.entries(parsed)) {
    if (!isAdapter(adapter)) {
      throw new Error(
        `${RESOURCES_KEY} names an unknown adapter: ${adapter} (known: ${SCANNER_ADAPTERS.join(', ')})`,
      );
    }
    if (!isPlainObject(overrides)) {
      throw new Error(`${RESOURCES_KEY}: ${adapter} must be a JSON object`);
    }
    for (const [field, quantity] of Object.entries(overrides)) {
      if (!isResourceField(field)) {
        throw new Error(
          `${RESOURCES_KEY}: ${adapter}.${field} is not one of ${RESOURCE_FIELDS.join(', ')}`,
        );
      }
      if (
        typeof quantity !== 'string' ||
        !SCANNER_QUANTITY_PATTERN.test(quantity)
      ) {
        throw new Error(
          `${RESOURCES_KEY}: ${adapter}.${field} must be a Kubernetes quantity (for example 500m or 2Gi)`,
        );
      }
      resources[adapter][field] = quantity;
    }
  }
  return resources;
}

/** null when neither variable is set; throws Error(fixed message) when only one is. */
export function readClusterScanningConfig(
  env: NodeJS.ProcessEnv,
): ClusterScanningConfig | null {
  const kubeconfigFile = valueOf(env, 'CYBEDEFEND_SCANNER_KUBECONFIG_FILE');
  const rawNamespace = valueOf(env, 'CYBEDEFEND_SCANNER_NAMESPACE');
  if (kubeconfigFile === undefined && rawNamespace === undefined) return null;
  if (kubeconfigFile === undefined || rawNamespace === undefined) {
    throw new Error(PAIR_MESSAGE);
  }

  const namespace = checked(
    env,
    'CYBEDEFEND_SCANNER_NAMESPACE',
    SCANNER_NAMESPACE_PATTERN,
    'must be a Kubernetes namespace name (lowercase letters, digits and dashes, 63 characters at most)',
  );
  const imageRegistry =
    checked(
      env,
      'CYBEDEFEND_SCANNER_IMAGE_REGISTRY',
      SCANNER_IMAGE_REGISTRY_PATTERN,
      'must be a lowercase registry host, with an optional port and path, and no scheme',
    ) ?? DEFAULT_SCANNER_IMAGE_REGISTRY;
  const imageTag =
    checked(
      env,
      'CYBEDEFEND_SCANNER_IMAGE_TAG',
      SCANNER_IMAGE_TAG_PATTERN,
      'must be an image tag (letters, digits, underscores, dots and dashes, not starting with a dot or a dash)',
    ) ?? DEFAULT_SCANNER_IMAGE_TAG;
  const imagePullSecret =
    checked(
      env,
      'CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET',
      SCANNER_PULL_SECRET_PATTERN,
      'must be a Kubernetes Secret name (a lowercase DNS subdomain)',
    ) ?? null;
  const maxConcurrent = checked(
    env,
    'CYBEDEFEND_SCANNER_MAX_CONCURRENT',
    SCANNER_MAX_CONCURRENT_PATTERN,
    'must be a whole number, at least one and at most fifty',
  );
  const maxConcurrentPerOrganization = checked(
    env,
    'CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION',
    SCANNER_MAX_CONCURRENT_PATTERN,
    'must be a whole number, at least one and at most fifty',
  );
  const keepPods = checked(
    env,
    'CYBEDEFEND_SCANNER_KEEP_PODS',
    SCANNER_KEEP_PODS_PATTERN,
    'must be true or false',
  );
  const allowInsecureTls = checked(
    env,
    'CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS',
    SCANNER_ALLOW_INSECURE_TLS_PATTERN,
    'must be true or false',
  );
  const repositoryRule =
    'must be an OCI repository without a scheme (host[:port]/path[:tag]), several separated by commas';
  const trivyDbRepository =
    checked(
      env,
      'CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY',
      SCANNER_TRIVY_DB_REPOSITORY_PATTERN,
      repositoryRule,
    ) ?? null;
  const trivyJavaDbRepository =
    checked(
      env,
      'CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY',
      SCANNER_TRIVY_DB_REPOSITORY_PATTERN,
      repositoryRule,
    ) ?? null;
  const resources = readResources(valueOf(env, RESOURCES_KEY));

  const frontendUrl = valueOf(env, 'FRONTEND_URL');
  if (frontendUrl === undefined) {
    throw new Error(
      'FRONTEND_URL must be set when cluster scanning is configured',
    );
  }

  const max =
    maxConcurrent === undefined
      ? DEFAULT_SCANNER_MAX_CONCURRENT
      : Number(maxConcurrent);
  return {
    kubeconfigFile,
    namespace,
    imageRegistry,
    imageTag,
    imagePullSecret,
    maxConcurrent: max,
    // Above the instance maximum it would never be reached: clamped to it.
    maxConcurrentPerOrganization: Math.min(
      max,
      maxConcurrentPerOrganization === undefined
        ? max
        : Number(maxConcurrentPerOrganization),
    ),
    keepPods: keepPods === 'true',
    allowInsecureTls: allowInsecureTls === 'true',
    trivyDbRepository,
    trivyJavaDbRepository,
    resources,
    apiUrl: `${frontendUrl.replace(/\/+$/, '')}/api`,
    storagePublicUrl: valueOf(env, 'S3_PUBLIC_ENDPOINT') ?? null,
    instanceId: instanceIdOf(frontendUrl),
  };
}

/**
 * The variables the configuration reads, taken from process.env by name (the
 * environment inventory, deploy/community/env-inventory.json, lists exactly
 * these for security-scanning).
 */
export function clusterScanningEnv(): NodeJS.ProcessEnv {
  return {
    CYBEDEFEND_SCANNER_KUBECONFIG_FILE:
      process.env.CYBEDEFEND_SCANNER_KUBECONFIG_FILE,
    CYBEDEFEND_SCANNER_NAMESPACE: process.env.CYBEDEFEND_SCANNER_NAMESPACE,
    CYBEDEFEND_SCANNER_IMAGE_REGISTRY:
      process.env.CYBEDEFEND_SCANNER_IMAGE_REGISTRY,
    CYBEDEFEND_SCANNER_IMAGE_TAG: process.env.CYBEDEFEND_SCANNER_IMAGE_TAG,
    CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET:
      process.env.CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET,
    CYBEDEFEND_SCANNER_MAX_CONCURRENT:
      process.env.CYBEDEFEND_SCANNER_MAX_CONCURRENT,
    CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION:
      process.env.CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION,
    CYBEDEFEND_SCANNER_RESOURCES: process.env.CYBEDEFEND_SCANNER_RESOURCES,
    CYBEDEFEND_SCANNER_KEEP_PODS: process.env.CYBEDEFEND_SCANNER_KEEP_PODS,
    CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS:
      process.env.CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS,
    CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY:
      process.env.CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY,
    CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY:
      process.env.CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY,
    FRONTEND_URL: process.env.FRONTEND_URL,
    S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
  };
}

/**
 * How many scans of one organization may run at once: the per-organization
 * setting, the instance maximum when unset, kept to a whole number between 1
 * and the instance maximum. Never below 1, whatever the value: a limit under
 * 1 would leave an organization's scans queued until they time out.
 */
export function organizationScanLimit(config: ClusterScanningConfig): number {
  const max = Math.max(1, Math.floor(config.maxConcurrent));
  const value = config.maxConcurrentPerOrganization ?? max;
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

/**
 * The CLUSTER_SCANNING_CONFIG provider: evaluated when the module is
 * instantiated, so a partial configuration fails the boot.
 */
export const clusterScanningConfigProvider: FactoryProvider<ClusterScanningConfig | null> =
  {
    provide: CLUSTER_SCANNING_CONFIG,
    useFactory: () => readClusterScanningConfig(clusterScanningEnv()),
  };
