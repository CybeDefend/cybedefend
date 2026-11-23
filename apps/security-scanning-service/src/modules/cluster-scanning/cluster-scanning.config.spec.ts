import { validationSchema } from '../../core/config/validation.schema';
import {
  CLUSTER_SCANNING_CONFIG,
  clusterScanningConfigProvider,
  DEFAULT_SCANNER_IMAGE_TAG,
  instanceIdOf,
  normalisedInstanceUrl,
  readClusterScanningConfig,
} from './cluster-scanning.config';

/**
 * Community scans on a connected Kubernetes cluster:
 * the CYBEDEFEND_SCANNER_* configuration. Both the kubeconfig file and the
 * namespace set: scanning is configured. Neither: import-only. One without the
 * other: the boot fails. An empty value counts as unset.
 */
const BOTH = {
  CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/k',
  CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
  FRONTEND_URL: 'https://a.example',
};

const errorOf = (env: NodeJS.ProcessEnv): Error => {
  try {
    readClusterScanningConfig(env);
  } catch (e) {
    return e as Error;
  }
  throw new Error('readClusterScanningConfig did not throw');
};

describe('readClusterScanningConfig', () => {
  it('is null when neither variable is set or both are empty', () => {
    expect(readClusterScanningConfig({})).toBeNull();
    expect(
      readClusterScanningConfig({
        CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '',
        CYBEDEFEND_SCANNER_NAMESPACE: '',
      }),
    ).toBeNull();
  });

  it('is null without the pair even when the other scanner keys are set', () => {
    expect(
      readClusterScanningConfig({
        CYBEDEFEND_SCANNER_MAX_CONCURRENT: '0',
        CYBEDEFEND_SCANNER_RESOURCES: 'not json',
        FRONTEND_URL: 'https://a.example',
      }),
    ).toBeNull();
  });

  it.each([
    ['CYBEDEFEND_SCANNER_KUBECONFIG_FILE'],
    ['CYBEDEFEND_SCANNER_NAMESPACE'],
  ])('refuses %s alone', (k) => {
    expect(() => readClusterScanningConfig({ [k]: 'x' })).toThrow(
      'CYBEDEFEND_SCANNER_KUBECONFIG_FILE and CYBEDEFEND_SCANNER_NAMESPACE must be set together, or neither',
    );
  });

  it('refuses one set while the other is empty', () => {
    expect(() =>
      readClusterScanningConfig({
        CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/k',
        CYBEDEFEND_SCANNER_NAMESPACE: '',
      }),
    ).toThrow(
      'CYBEDEFEND_SCANNER_KUBECONFIG_FILE and CYBEDEFEND_SCANNER_NAMESPACE must be set together, or neither',
    );
  });

  it('applies the defaults', () => {
    expect(readClusterScanningConfig(BOTH)).toEqual(
      expect.objectContaining({
        kubeconfigFile: '/run/k',
        namespace: 'scans',
        imageRegistry: 'ghcr.io/cybedefend',
        imageTag: '1.0.0',
        maxConcurrent: 2,
        keepPods: false,
        allowInsecureTls: false,
        trivyDbRepository: null,
        trivyJavaDbRepository: null,
        imagePullSecret: null,
        apiUrl: 'https://a.example/api',
        resources: expect.objectContaining({
          opengrep: {
            cpuRequest: '500m',
            cpuLimit: '1',
            memoryRequest: '1Gi',
            memoryLimit: '2Gi',
          },
        }),
      }),
    );
    expect(DEFAULT_SCANNER_IMAGE_TAG).toBe('1.0.0');
    expect(CLUSTER_SCANNING_CONFIG).toBe('CLUSTER_SCANNING_CONFIG');
  });

  it('gives every adapter its catalogue requests and limits by default', () => {
    expect(readClusterScanningConfig(BOTH).resources).toEqual({
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
    });
  });

  it('reads every set value', () => {
    expect(
      readClusterScanningConfig({
        ...BOTH,
        CYBEDEFEND_SCANNER_IMAGE_REGISTRY: 'registry.example:5000/sec/tools',
        CYBEDEFEND_SCANNER_IMAGE_TAG: '1.2.3-rc.1',
        CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET: 'regcred.scans',
        CYBEDEFEND_SCANNER_MAX_CONCURRENT: '50',
        CYBEDEFEND_SCANNER_KEEP_PODS: 'true',
        CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS: 'true',
        CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY:
          'registry.example:5000/mirror/trivy-db:2',
        CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY:
          'registry.example:5000/mirror/trivy-java-db:1',
      }),
    ).toEqual(
      expect.objectContaining({
        allowInsecureTls: true,
        trivyDbRepository: 'registry.example:5000/mirror/trivy-db:2',
        trivyJavaDbRepository: 'registry.example:5000/mirror/trivy-java-db:1',
        imageRegistry: 'registry.example:5000/sec/tools',
        imageTag: '1.2.3-rc.1',
        imagePullSecret: 'regcred.scans',
        maxConcurrent: 50,
        keepPods: true,
      }),
    );
  });

  it('treats an empty optional value as unset', () => {
    expect(
      readClusterScanningConfig({
        ...BOTH,
        CYBEDEFEND_SCANNER_IMAGE_REGISTRY: '',
        CYBEDEFEND_SCANNER_IMAGE_TAG: '',
        CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET: '',
        CYBEDEFEND_SCANNER_MAX_CONCURRENT: '',
        CYBEDEFEND_SCANNER_RESOURCES: '',
        CYBEDEFEND_SCANNER_KEEP_PODS: '',
        CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS: '',
        CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY: '',
        CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY: '',
      }),
    ).toEqual(
      expect.objectContaining({
        allowInsecureTls: false,
        trivyDbRepository: null,
        trivyJavaDbRepository: null,
        imageRegistry: 'ghcr.io/cybedefend',
        imageTag: DEFAULT_SCANNER_IMAGE_TAG,
        imagePullSecret: null,
        maxConcurrent: 2,
        keepPods: false,
      }),
    );
  });

  it('refuses CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS other than true or false', () => {
    expect(
      errorOf({ ...BOTH, CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS: 'yes' })
        .message,
    ).toBe('CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS must be true or false');
  });

  describe('instanceId', () => {
    it('is the first 16 hex of sha256 of FRONTEND_URL', () => {
      expect(readClusterScanningConfig(BOTH).instanceId).toBe(
        '38612c965a9c4c35',
      );
      expect(instanceIdOf('https://a.example')).toBe('38612c965a9c4c35');
    });

    it.each([
      ['  https://a.example  '],
      ['https://a.example/'],
      ['https://a.example///'],
      ['HTTPS://A.EXAMPLE'],
      [' HTTPS://A.Example/ '],
    ])(
      'normalises %j to the same id (trimmed, no trailing slash, lower-case scheme and host)',
      (url) => {
        expect(instanceIdOf(url)).toBe('38612c965a9c4c35');
        expect(
          readClusterScanningConfig({ ...BOTH, FRONTEND_URL: url }).instanceId,
        ).toBe('38612c965a9c4c35');
      },
    );

    it('keeps the case of the path, and two instances get two ids', () => {
      expect(normalisedInstanceUrl('HTTPS://A.Example/AppSec/')).toBe(
        'https://a.example/AppSec',
      );
      expect(instanceIdOf('https://a.example/appsec')).not.toBe(
        instanceIdOf('https://a.example/AppSec'),
      );
      expect(instanceIdOf('https://b.example')).not.toBe(
        instanceIdOf('https://a.example'),
      );
      expect(instanceIdOf('https://a.example')).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  it('builds apiUrl without a doubled slash', () => {
    expect(
      readClusterScanningConfig({ ...BOTH, FRONTEND_URL: 'https://a.example/' })
        .apiUrl,
    ).toBe('https://a.example/api');
  });

  it('refuses a configuration without FRONTEND_URL', () => {
    expect(() =>
      readClusterScanningConfig({
        CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/k',
        CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
      }),
    ).toThrow('FRONTEND_URL must be set when cluster scanning is configured');
  });

  it('carries the storage public address the pods fetch the archive from', () => {
    expect(
      readClusterScanningConfig({
        ...BOTH,
        S3_PUBLIC_ENDPOINT: 'https://files.example',
      }).storagePublicUrl,
    ).toBe('https://files.example');
    expect(readClusterScanningConfig(BOTH).storagePublicUrl).toBeNull();
  });

  it('merges CYBEDEFEND_SCANNER_RESOURCES per adapter', () => {
    const cfg = readClusterScanningConfig({
      ...BOTH,
      CYBEDEFEND_SCANNER_RESOURCES: JSON.stringify({
        gitleaks: { memoryLimit: '2Gi' },
        'trivy-fs': { cpuRequest: '0.5', cpuLimit: '2' },
      }),
    });
    expect(cfg.resources.gitleaks).toEqual({
      cpuRequest: '250m',
      cpuLimit: '500m',
      memoryRequest: '512Mi',
      memoryLimit: '2Gi',
    });
    expect(cfg.resources['trivy-fs']).toEqual({
      cpuRequest: '0.5',
      cpuLimit: '2',
      memoryRequest: '1Gi',
      memoryLimit: '2Gi',
    });
    expect(cfg.resources.opengrep.memoryLimit).toBe('2Gi');
  });

  it('refuses an unknown adapter, naming it', () => {
    const err = errorOf({
      ...BOTH,
      CYBEDEFEND_SCANNER_RESOURCES: JSON.stringify({ semgrep: {} }),
    });
    expect(err.message).toContain('CYBEDEFEND_SCANNER_RESOURCES');
    expect(err.message).toContain('semgrep');
  });

  it('refuses a bad quantity, naming the key and never the value', () => {
    const err = errorOf({
      ...BOTH,
      CYBEDEFEND_SCANNER_RESOURCES: JSON.stringify({
        opengrep: { cpuLimit: 'lots' },
      }),
    });
    expect(err.message).toContain('CYBEDEFEND_SCANNER_RESOURCES');
    expect(err.message).toContain('opengrep.cpuLimit');
    expect(err.message).not.toContain('lots');
  });

  it.each([
    ['an unknown field', JSON.stringify({ opengrep: { cpu: '1' } }), 'cpu'],
    [
      'an adapter that is no object',
      JSON.stringify({ zizmor: 'big' }),
      'zizmor',
    ],
    ['a top level that is no object', JSON.stringify(['opengrep']), 'object'],
    [
      'a quantity that is no string',
      JSON.stringify({ gitleaks: { cpuLimit: 2 } }),
      'gitleaks.cpuLimit',
    ],
  ])('refuses %s', (_case, value, named) => {
    const err = errorOf({ ...BOTH, CYBEDEFEND_SCANNER_RESOURCES: value });
    expect(err.message).toContain('CYBEDEFEND_SCANNER_RESOURCES');
    expect(err.message).toContain(named);
  });

  it('refuses CYBEDEFEND_SCANNER_RESOURCES that is not JSON, without echoing it', () => {
    const err = errorOf({
      ...BOTH,
      CYBEDEFEND_SCANNER_RESOURCES: '{opengrep: secret-ish',
    });
    expect(err.message).toContain('CYBEDEFEND_SCANNER_RESOURCES');
    expect(err.message).not.toContain('secret-ish');
  });

  it.each([
    ['CYBEDEFEND_SCANNER_MAX_CONCURRENT', '0'],
    ['CYBEDEFEND_SCANNER_MAX_CONCURRENT', '51'],
    ['CYBEDEFEND_SCANNER_MAX_CONCURRENT', '2.5'],
    ['CYBEDEFEND_SCANNER_MAX_CONCURRENT', 'two'],
    ['CYBEDEFEND_SCANNER_NAMESPACE', 'Scans'],
    ['CYBEDEFEND_SCANNER_NAMESPACE', '-scans'],
    ['CYBEDEFEND_SCANNER_NAMESPACE', 'a'.repeat(64)],
    ['CYBEDEFEND_SCANNER_IMAGE_REGISTRY', 'GHCR.io/CybeDefend'],
    ['CYBEDEFEND_SCANNER_IMAGE_REGISTRY', 'https://ghcr.io/cybedefend'],
    ['CYBEDEFEND_SCANNER_IMAGE_TAG', '.1.0'],
    ['CYBEDEFEND_SCANNER_IMAGE_TAG', 'a'.repeat(129)],
    ['CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET', 'Reg_Cred'],
    ['CYBEDEFEND_SCANNER_KEEP_PODS', 'yes'],
    ['CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS', '1'],
    ['CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY', 'mirror.example/trivy db'],
    ['CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY', 'mirror.example/db\nX=1'],
    ['CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY', 'https://mirror.example/j'],
  ])('refuses %s=%s, naming the key and never the value', (key, value) => {
    // The pair stays set (kubeconfig file included) so that the case tests the
    // key's own rule, never the « set together » rule.
    const err = errorOf({ ...BOTH, [key]: value });
    expect(err.message).toContain(key);
    expect(err.message).not.toContain(value);
    expect(err.message).not.toMatch(/must be set together/);
  });
});

describe('clusterScanningConfigProvider', () => {
  const KEYS = [
    'CYBEDEFEND_SCANNER_KUBECONFIG_FILE',
    'CYBEDEFEND_SCANNER_NAMESPACE',
    'CYBEDEFEND_SCANNER_MAX_CONCURRENT',
    'FRONTEND_URL',
    'S3_PUBLIC_ENDPOINT',
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('provides CLUSTER_SCANNING_CONFIG from process.env', () => {
    process.env.CYBEDEFEND_SCANNER_KUBECONFIG_FILE = '/run/k';
    process.env.CYBEDEFEND_SCANNER_NAMESPACE = 'scans';
    process.env.CYBEDEFEND_SCANNER_MAX_CONCURRENT = '7';
    process.env.FRONTEND_URL = 'https://a.example';
    process.env.S3_PUBLIC_ENDPOINT = 'https://files.example';
    expect(clusterScanningConfigProvider.provide).toBe(CLUSTER_SCANNING_CONFIG);
    expect(clusterScanningConfigProvider.useFactory()).toEqual(
      expect.objectContaining({
        kubeconfigFile: '/run/k',
        namespace: 'scans',
        maxConcurrent: 7,
        apiUrl: 'https://a.example/api',
        storagePublicUrl: 'https://files.example',
      }),
    );
  });

  it('provides null when the pair is unset', () => {
    delete process.env.CYBEDEFEND_SCANNER_KUBECONFIG_FILE;
    delete process.env.CYBEDEFEND_SCANNER_NAMESPACE;
    expect(clusterScanningConfigProvider.useFactory()).toBeNull();
  });

  it('fails when only one of the pair is set', () => {
    process.env.CYBEDEFEND_SCANNER_KUBECONFIG_FILE = '/run/k';
    delete process.env.CYBEDEFEND_SCANNER_NAMESPACE;
    expect(() => clusterScanningConfigProvider.useFactory()).toThrow(
      'CYBEDEFEND_SCANNER_KUBECONFIG_FILE and CYBEDEFEND_SCANNER_NAMESPACE must be set together, or neither',
    );
  });
});

describe('CYBEDEFEND_SCANNER_* in the configuration schema', () => {
  const key = (name: string) => validationSchema.extract(name);

  it.each([
    'CYBEDEFEND_SCANNER_KUBECONFIG_FILE',
    'CYBEDEFEND_SCANNER_NAMESPACE',
    'CYBEDEFEND_SCANNER_IMAGE_REGISTRY',
    'CYBEDEFEND_SCANNER_IMAGE_TAG',
    'CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET',
    'CYBEDEFEND_SCANNER_MAX_CONCURRENT',
    'CYBEDEFEND_SCANNER_RESOURCES',
    'CYBEDEFEND_SCANNER_KEEP_PODS',
    'CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS',
    'CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY',
    'CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY',
  ])('%s is optional and empty counts as unset', (name) => {
    expect(key(name).validate(undefined).error).toBeUndefined();
    const { error, value } = key(name).validate('');
    expect(error).toBeUndefined();
    expect(value).toBeUndefined();
  });

  it.each([
    ['CYBEDEFEND_SCANNER_KUBECONFIG_FILE', '/run/cybedefend/kubeconfig'],
    ['CYBEDEFEND_SCANNER_NAMESPACE', 'cybedefend-scans'],
    ['CYBEDEFEND_SCANNER_IMAGE_REGISTRY', 'ghcr.io/cybedefend'],
    ['CYBEDEFEND_SCANNER_IMAGE_REGISTRY', 'registry.example:5000/sec/tools'],
    ['CYBEDEFEND_SCANNER_IMAGE_TAG', '1.0.0'],
    ['CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET', 'regcred'],
    ['CYBEDEFEND_SCANNER_MAX_CONCURRENT', '1'],
    ['CYBEDEFEND_SCANNER_MAX_CONCURRENT', '50'],
    ['CYBEDEFEND_SCANNER_RESOURCES', '{"opengrep":{"cpuLimit":"2"}}'],
    ['CYBEDEFEND_SCANNER_KEEP_PODS', 'true'],
    ['CYBEDEFEND_SCANNER_KEEP_PODS', 'false'],
    ['CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS', 'true'],
    ['CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS', 'false'],
    [
      'CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY',
      'mirror.gcr.io/aquasec/trivy-db:2',
    ],
    [
      'CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY',
      'registry.example:5000/a/trivy-db,ghcr.io/aquasecurity/trivy-db',
    ],
    [
      'CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY',
      'registry.example/mirror/trivy-java-db@sha256:abc123',
    ],
  ])('accepts %s=%s', (name, value) => {
    expect(key(name).validate(value).error).toBeUndefined();
  });

  it.each([
    ['CYBEDEFEND_SCANNER_NAMESPACE', 'Scans'],
    ['CYBEDEFEND_SCANNER_IMAGE_REGISTRY', 'https://ghcr.io/cybedefend'],
    ['CYBEDEFEND_SCANNER_IMAGE_TAG', '-1.0.0'],
    ['CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET', 'Reg_Cred'],
    ['CYBEDEFEND_SCANNER_MAX_CONCURRENT', '0'],
    ['CYBEDEFEND_SCANNER_MAX_CONCURRENT', '51'],
    ['CYBEDEFEND_SCANNER_KEEP_PODS', 'yes'],
    ['CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS', '1'],
    ['CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY', 'a b'],
    ['CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY', 'https://mirror.example/db'],
    ['CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY', 'mirror.example/j\n'],
  ])('refuses %s=%s', (name, value) => {
    expect(key(name).validate(value).error).toBeDefined();
  });
});
